import { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { logger } from "../../lib/logger";
import { isKnownEventType, validateEventPayload, EngineEventType } from "./triggers";
import { enqueueTriggerMatch } from "./queue";

type Tx = PrismaClient | Prisma.TransactionClient;

/**
 * Writes the outbox row that WILL become a trigger-match job. Call this from inside the same
 * `prisma.$transaction` as the business write that caused the event (e.g. creating an
 * EngineLead) by passing the transaction client as `tx` — the event can then never be lost
 * between that commit and the queue publish, because it IS part of the commit. The actual
 * BullMQ enqueue happens afterwards via the relay (outboxRelayTick), which is safe to retry
 * indefinitely since enqueueing is a no-op if Redis is briefly down.
 */
export async function emitEvent(
  tx: Tx,
  eventType: EngineEventType | string,
  payload: unknown,
  dedupeKey?: string,
): Promise<{ id: string; deduped: boolean }> {
  if (!isKnownEventType(eventType)) throw new Error(`Cannot emit unknown event type "${eventType}"`);
  const validated = validateEventPayload(eventType, payload);
  if (!validated.ok) throw new Error(`Invalid payload for event "${eventType}": ${validated.error}`);
  if (dedupeKey) {
    const existing = await tx.engineOutboxEvent.findUnique({ where: { dedupeKey } });
    if (existing) return { id: existing.id, deduped: true };
  }
  const row = await tx.engineOutboxEvent.create({
    data: { eventType, payload: validated.payload as Prisma.InputJsonValue, dedupeKey },
  });
  return { id: row.id, deduped: false };
}

const MAX_OUTBOX_ATTEMPTS = 50; // ~ many hours of 1-minute relay ticks before giving up and surfacing as FAILED

/**
 * Publishes every PENDING outbox row to the trigger-match queue, oldest first. Idempotent and
 * safe to run concurrently with itself skipped by the scheduler's own guard(); a row that fails
 * to enqueue (Redis down) is left PENDING with attempts incremented, so the next tick retries it
 * — at-least-once delivery, never silently dropped.
 */
export async function outboxRelayTick(): Promise<{ published: number; failed: number }> {
  const pending = await prisma.engineOutboxEvent.findMany({ where: { status: "PENDING" }, orderBy: { createdAt: "asc" }, take: 100 });
  let published = 0, failed = 0;
  for (const row of pending) {
    try {
      await enqueueTriggerMatch({ outboxId: row.id, eventType: row.eventType, payload: row.payload });
      await prisma.engineOutboxEvent.update({ where: { id: row.id }, data: { status: "PUBLISHED", publishedAt: new Date() } });
      published++;
    } catch (err) {
      const attempts = row.attempts + 1;
      const message = err instanceof Error ? err.message : String(err);
      await prisma.engineOutboxEvent.update({
        where: { id: row.id },
        data: { attempts, lastError: message, status: attempts >= MAX_OUTBOX_ATTEMPTS ? "FAILED" : "PENDING" },
      });
      logger.warn({ eventId: row.id, attempts, err: message }, "[engine-outbox] publish failed, will retry");
      failed++;
    }
  }
  return { published, failed };
}
