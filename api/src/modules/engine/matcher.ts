import crypto from "node:crypto";
import { prisma } from "../../lib/prisma";
import { logger } from "../../lib/logger";
import { EngineTriggerType } from "@prisma/client";
import { enqueueExecutionRun } from "./queue";
import type { TriggerMatchJobPayload } from "./queue";

function idempotencyKeyFor(workflowId: string, source: "event" | "webhook" | "cron" | "manual", dedupe: string): string {
  return crypto.createHash("sha256").update(`${workflowId}:${source}:${dedupe}`).digest("hex");
}

/**
 * Matches one fired trigger against enabled workflows and creates (at most) one new
 * EngineExecution per match — idempotent on EngineExecution.idempotencyKey, so re-processing
 * the same outbox row (a duplicate BullMQ delivery, or a relay retry) can never create a
 * second execution for the same real-world event.
 */
export async function matchTrigger(job: TriggerMatchJobPayload): Promise<{ created: number; deduped: number }> {
  let workflows;
  if (job.workflowKey) {
    const wf = await prisma.engineWorkflow.findUnique({ where: { key: job.workflowKey }, include: { currentVersion: true } });
    workflows = wf && wf.enabled && wf.currentVersion?.status === "PUBLISHED" ? [wf] : [];
  } else {
    workflows = await prisma.engineWorkflow.findMany({
      where: { enabled: true, triggerType: EngineTriggerType.EVENT, currentVersion: { status: "PUBLISHED" } },
      include: { currentVersion: true },
    });
    workflows = workflows.filter((w) => (w.triggerConfig as { eventType?: string }).eventType === job.eventType);
  }

  let created = 0, deduped = 0;
  for (const wf of workflows) {
    if (!wf.currentVersion) continue;
    const source = job.outboxId ? "event" : (job.source ?? "manual");
    const dedupe = job.outboxId ?? `${job.eventType}:${JSON.stringify(job.payload)}`;
    const idempotencyKey = idempotencyKeyFor(wf.id, source as never, dedupe);
    try {
      const execution = await prisma.engineExecution.create({
        data: {
          workflowId: wf.id, versionId: wf.currentVersion.id, status: "QUEUED",
          triggerType: wf.triggerType, triggerPayload: job.payload as never,
          idempotencyKey, correlationId: crypto.randomUUID(),
          maxAttempts: (wf.currentVersion.definition as { maxAttempts?: number }).maxAttempts ?? 3,
        },
      });
      await enqueueExecutionRun(execution.id);
      created++;
    } catch (err) {
      if (err instanceof Error && "code" in err && (err as { code?: string }).code === "P2002") {
        deduped++; // already created for this exact event — not an error
        continue;
      }
      logger.error({ workflowId: wf.id, err: err instanceof Error ? err.message : String(err) }, "[engine] matchTrigger: failed to create execution");
    }
  }
  return { created, deduped };
}
