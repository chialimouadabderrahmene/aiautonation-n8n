import { prisma } from "../../lib/prisma";
import { n8nClient, N8nExecution, getN8nConnection } from "./client";
import { timedFetch, scrubSecrets } from "../../lib/http";

/**
 * Mirrors n8n execution metadata (never execution DATA — it contains phone
 * numbers and message text) into AutomationExecution, so the Executions and
 * Reports screens show every automation run in one place.
 */

const STATUS_MAP: Record<string, "RUNNING" | "SUCCESS" | "FAILED" | "CANCELLED"> = {
  success: "SUCCESS",
  error: "FAILED",
  crashed: "FAILED",
  canceled: "CANCELLED",
  running: "RUNNING",
  waiting: "RUNNING",
  new: "RUNNING",
};

async function fetchErrorMessage(id: string): Promise<string | null> {
  try {
    const conn = await getN8nConnection();
    const { res } = await timedFetch(`${conn.baseUrl}/api/v1/executions/${encodeURIComponent(id)}?includeData=true`, { headers: { "X-N8N-API-KEY": conn.apiKey } }, 15_000);
    if (!res.ok) return null;
    const body = (await res.json()) as { data?: { resultData?: { error?: { message?: string; node?: { name?: string } }; lastNodeExecuted?: string } } };
    const err = body.data?.resultData?.error;
    if (!err?.message) return null;
    const node = err.node?.name ?? body.data?.resultData?.lastNodeExecuted;
    return scrubSecrets(`${node ? `[${node}] ` : ""}${err.message}`, []).slice(0, 500);
  } catch {
    return null;
  }
}

export async function pollN8nExecutions(): Promise<{ upserted: number }> {
  const executions: N8nExecution[] = await n8nClient.listExecutions(100);
  const workflows = await prisma.workflowConfig.findMany({ where: { n8nWorkflowId: { not: null } } });
  const byN8nId = new Map(workflows.map((w) => [w.n8nWorkflowId!, w]));
  let upserted = 0;

  for (const ex of executions) {
    const status = STATUS_MAP[ex.status] ?? "RUNNING";
    const wf = byN8nId.get(ex.workflowId);
    const existing = await prisma.automationExecution.findUnique({ where: { source_externalId: { source: "N8N", externalId: ex.id } } });
    if (existing && existing.status === status && existing.finishedAt) continue;

    const startedAt = new Date(ex.startedAt);
    const finishedAt = ex.stoppedAt && status !== "RUNNING" ? new Date(ex.stoppedAt) : null;
    const error = status === "FAILED" && !existing?.error ? await fetchErrorMessage(ex.id) : existing?.error ?? null;
    const data = {
      workflowConfigId: wf?.id ?? null,
      trigger: ex.mode,
      mode: ex.mode,
      provider: "n8n",
      status,
      startedAt,
      finishedAt,
      durationMs: finishedAt ? finishedAt.getTime() - startedAt.getTime() : null,
      relatedEntityType: wf ? "WorkflowConfig" : null,
      relatedEntityId: wf?.key ?? ex.workflowId,
      error: status === "FAILED" ? error ?? "Execution failed (open n8n for details)" : null,
      retryCount: ex.retryOf ? 1 : 0,
    };
    await prisma.automationExecution.upsert({
      where: { source_externalId: { source: "N8N", externalId: ex.id } },
      update: data,
      create: { source: "N8N", externalId: ex.id, ...data },
    });
    upserted += 1;

    if (wf && finishedAt && (!wf.lastExecutionAt || wf.lastExecutionAt < finishedAt)) {
      await prisma.workflowConfig.update({ where: { id: wf.id }, data: { lastExecutionAt: finishedAt, lastExecutionOk: status === "SUCCESS" } });
    }
  }
  return { upserted };
}
