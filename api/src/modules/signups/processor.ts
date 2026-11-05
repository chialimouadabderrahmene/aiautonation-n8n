import { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { logger } from "../../lib/logger";
import { getSetting } from "../settings/schema";
import { sendOperatorMessage } from "../telegram/telegram";

/**
 * Turns Eki marketplace account-created events (stored by
 * POST /api/attribution/events) into an operator Telegram alert.
 *
 * Exactly-once per event: the claim is an AutomationExecution row with
 * source CONTROL_CENTER and externalId = eventId, protected by the
 * @@unique([source, externalId]) constraint. Whoever creates the row owns
 * the event; everyone else skips it. Test accounts are claimed and
 * recorded as CANCELLED so they are never retried or announced.
 */

export const SIGNUP_TRIGGER = "eki_signup";
export const SIGNUP_KINDS = ["user_registered", "vendor_store_created"] as const;
export type SignupKind = (typeof SIGNUP_KINDS)[number];

/** Events older than this are never announced (avoids a flood on first deploy). */
const LOOKBACK_MS = 7 * 86_400_000;
const BATCH = 25;

export interface SignupMetadata {
  kind: SignupKind;
  role?: string;
  country?: string;
  signupMethod?: string;
  referred?: boolean;
  isTest?: boolean;
}

export interface SignupRunResult {
  blocked: boolean;
  sent: number;
  skippedTest: number;
  failed: number;
}

export function readSignupMetadata(metadata: Prisma.JsonValue): SignupMetadata | null {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null;
  const m = metadata as Record<string, unknown>;
  if (!(SIGNUP_KINDS as readonly string[]).includes(String(m.kind))) return null;
  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim().slice(0, 40) : undefined);
  return {
    kind: m.kind as SignupKind,
    role: str(m.role),
    country: str(m.country),
    signupMethod: str(m.signupMethod),
    referred: m.referred === true,
    isTest: m.isTest === true,
  };
}

/** Operator-facing text. Contains no personal data — the event carries none. */
export function formatSignupMessage(meta: SignupMetadata, event: { source?: string | null; campaignName?: string | null; occurredAt: Date }): string {
  const title = meta.kind === "vendor_store_created" ? "🏪 New Eki vendor store" : "🆕 New Eki account";
  const lines = [
    title,
    `Role: ${meta.role ?? "—"} · Country: ${meta.country ?? "—"}`,
    `Signup: ${meta.signupMethod ?? "—"}${meta.referred ? " · referred" : ""}`,
  ];
  if (event.source || event.campaignName) lines.push(`Attribution: ${[event.source, event.campaignName].filter(Boolean).join(" / ")}`);
  lines.push(`At: ${event.occurredAt.toISOString()}`);
  return lines.join("\n");
}

function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError ? err.code === "P2002" : (err as { code?: string } | null)?.code === "P2002";
}

export async function processSignupEvents(now = new Date()): Promise<SignupRunResult> {
  const result: SignupRunResult = { blocked: false, sent: 0, skippedTest: 0, failed: 0 };
  if (await getSetting<boolean>("autopilotStop")) return { ...result, blocked: true };

  const events = await prisma.attributionEvent.findMany({
    where: { eventType: "registration", createdAt: { gte: new Date(now.getTime() - LOOKBACK_MS) } },
    orderBy: { createdAt: "asc" },
    take: 200,
  });
  const candidates = events.flatMap((event) => {
    const meta = readSignupMetadata(event.metadata);
    return meta ? [{ event, meta }] : [];
  });
  if (!candidates.length) return result;

  const done = await prisma.automationExecution.findMany({
    where: { source: "CONTROL_CENTER", externalId: { in: candidates.map((c) => c.event.eventId) } },
    select: { externalId: true },
  });
  const doneIds = new Set(done.map((d) => d.externalId));

  for (const { event, meta } of candidates.filter((c) => !doneIds.has(c.event.eventId)).slice(0, BATCH)) {
    let execution;
    try {
      execution = await prisma.automationExecution.create({
        data: {
          source: "CONTROL_CENTER",
          externalId: event.eventId,
          trigger: SIGNUP_TRIGGER,
          provider: meta.isTest ? null : "telegram",
          relatedEntityType: "AttributionEvent",
          relatedEntityId: event.id,
          mode: meta.kind,
        },
      });
    } catch (err) {
      if (isUniqueViolation(err)) continue; // another run claimed it
      throw err;
    }
    const finish = (status: "SUCCESS" | "FAILED" | "CANCELLED", error?: string) =>
      prisma.automationExecution.update({
        where: { id: execution.id },
        data: { status, error: error ?? null, finishedAt: new Date(), durationMs: Date.now() - execution.startedAt.getTime() },
      });

    if (meta.isTest) {
      await finish("CANCELLED", "Test account — no notification sent");
      result.skippedTest += 1;
      continue;
    }
    try {
      await sendOperatorMessage(formatSignupMessage(meta, event));
      await finish("SUCCESS");
      result.sent += 1;
    } catch (err) {
      await finish("FAILED", err instanceof Error ? err.message : String(err));
      result.failed += 1;
    }
  }
  return result;
}

let inflight: Promise<void> | null = null;
let again = false;

/**
 * Runs the processor now (used right after ingest so alerts are instant).
 * Calls that arrive mid-run schedule one more pass instead of overlapping.
 * Never rejects; the scheduler retries on its own cadence.
 */
export function runSignupProcessing(): Promise<void> {
  if (inflight) {
    again = true;
    return inflight;
  }
  inflight = (async () => {
    do {
      again = false;
      try {
        await processSignupEvents();
      } catch (err) {
        logger.warn({ err: err instanceof Error ? err.message : String(err) }, "[signups] processing failed");
      }
    } while (again);
  })().finally(() => {
    inflight = null;
  });
  return inflight;
}

export function describeSignupRun(r: SignupRunResult): string {
  if (r.blocked) return "emergency stop enabled — skipped";
  return `sent ${r.sent}, test skipped ${r.skippedTest}, failed ${r.failed}`;
}

export interface SignupSummary {
  users: number;
  vendorStores: number;
  testAccounts: number;
  alertsSent: number;
  alertsFailed: number;
}

/** Report counters: real signups by kind, test accounts, and alert outcomes. */
export function summarizeSignups(events: { metadata: Prisma.JsonValue }[], alerts: { status: string }[]): SignupSummary {
  const metas = events.map((e) => readSignupMetadata(e.metadata)).filter((m): m is SignupMetadata => m !== null);
  const real = metas.filter((m) => !m.isTest);
  return {
    users: real.filter((m) => m.kind === "user_registered").length,
    vendorStores: real.filter((m) => m.kind === "vendor_store_created").length,
    testAccounts: metas.length - real.length,
    alertsSent: alerts.filter((a) => a.status === "SUCCESS").length,
    alertsFailed: alerts.filter((a) => a.status === "FAILED").length,
  };
}
