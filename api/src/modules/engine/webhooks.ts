import crypto from "node:crypto";
import { prisma } from "../../lib/prisma";
import { runExecution } from "./executor";

/**
 * WEBHOOK-triggered workflows run SYNCHRONOUSLY in the request handler (not via the queue) so
 * the HTTP response can reflect the execution's real outcome — the same request/response
 * contract the n8n `respondToWebhook` nodes gave these flows (03/04/07/08). The execution is
 * still a full, durable EngineExecution (steps, idempotency, audit) — "synchronous" only means
 * WHEN it runs, not that it skips any of the engine's guarantees.
 */
export async function runWebhookTrigger(workflowKey: string, payload: unknown): Promise<
  | { ok: true; status: "SUCCEEDED"; context: unknown; executionId: string }
  | { ok: false; status: "NOT_FOUND" | "DISABLED" | "FAILED"; message: string; executionId?: string }
> {
  const workflow = await prisma.engineWorkflow.findUnique({ where: { key: workflowKey }, include: { currentVersion: true } });
  if (!workflow) return { ok: false, status: "NOT_FOUND", message: `Unknown webhook "${workflowKey}"` };
  if (!workflow.enabled || !workflow.currentVersion || workflow.currentVersion.status !== "PUBLISHED") {
    return { ok: false, status: "DISABLED", message: "This automation is not currently enabled" };
  }

  const idempotencyKey = crypto.createHash("sha256").update(`${workflow.id}:webhook:${JSON.stringify(payload)}`).digest("hex");
  let executionId: string;
  const existing = await prisma.engineExecution.findUnique({ where: { idempotencyKey } });
  if (existing) {
    executionId = existing.id; // an identical retry of the same submission — reuse, never duplicate
  } else {
    const execution = await prisma.engineExecution.create({
      data: {
        workflowId: workflow.id, versionId: workflow.currentVersion.id, status: "QUEUED", triggerType: "WEBHOOK",
        triggerPayload: payload as never, idempotencyKey, correlationId: crypto.randomUUID(),
        maxAttempts: (workflow.currentVersion.definition as { maxAttempts?: number }).maxAttempts ?? 3,
      },
    });
    executionId = execution.id;
  }

  await runExecution(executionId);
  const final = await prisma.engineExecution.findUniqueOrThrow({ where: { id: executionId } });
  if (final.status === "SUCCEEDED") return { ok: true, status: "SUCCEEDED", context: final.context, executionId };
  if (final.status === "RETRYING" || final.status === "WAITING") {
    // Accepted, finishing asynchronously (e.g. it hit a delay step) — report accepted, not failed.
    return { ok: true, status: "SUCCEEDED", context: final.context, executionId };
  }
  return { ok: false, status: "FAILED", message: final.error ?? "The automation failed", executionId };
}
