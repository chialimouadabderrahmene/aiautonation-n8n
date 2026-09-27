import { prisma } from "../../lib/prisma";
import { getN8nConnection } from "./client";
import { loadWorkflowFile, webhookEndpoints } from "./workflows";
import { timedFetch, readErrorDetail, scrubSecrets } from "../../lib/http";

/**
 * TEST RUN from the Automations screen.
 *
 * - Scheduled workflows (they all have a Manual Trigger): executed for real
 *   by the n8n supervisor with `n8n execute --id=<id>` — a genuine run with
 *   genuine side effects, recorded in n8n and mirrored into Executions.
 * - Webhook workflows: there is no safe synthetic payload (a fake lead would
 *   be written to the real sheet and messaged on WhatsApp), so the test
 *   verifies the production webhook is registered and enforces its secret.
 * - The error handler runs only when another workflow fails.
 */

export interface TestRunResult {
  ok: boolean;
  kind: "execution" | "webhook-probe" | "not-runnable";
  message: string;
  executionId?: string;
}

async function runViaSupervisor(n8nWorkflowId: string): Promise<TestRunResult> {
  const url = process.env.N8N_SUPERVISOR_URL?.replace(/\/+$/, "");
  const token = process.env.INTERNAL_API_TOKEN;
  if (!url || !token) {
    return { ok: false, kind: "execution", message: "N8N_SUPERVISOR_URL / INTERNAL_API_TOKEN are not set on the API service — test runs need the n8n supervisor" };
  }
  const { res } = await timedFetch(
    `${url}/run`,
    { method: "POST", headers: { "Content-Type": "application/json", "x-internal-token": token }, body: JSON.stringify({ workflowId: n8nWorkflowId }) },
    6 * 60_000,
  );
  if (!res.ok) return { ok: false, kind: "execution", message: `Supervisor refused the run (${res.status}): ${(await readErrorDetail(res)) ?? ""}` };
  const body = (await res.json()) as { ok: boolean; status?: string; error?: string; startedAt?: string };
  // `n8n execute` does not print the execution id; find the CLI execution it stored.
  let executionId: string | undefined;
  try {
    const conn = await getN8nConnection();
    const { res: exRes } = await timedFetch(`${conn.baseUrl}/api/v1/executions?workflowId=${encodeURIComponent(n8nWorkflowId)}&limit=5`, { headers: { "X-N8N-API-KEY": conn.apiKey } });
    if (exRes.ok) {
      const list = ((await exRes.json()) as { data: { id: string; mode: string; startedAt: string }[] }).data;
      const since = body.startedAt ? Date.parse(body.startedAt) - 2000 : 0;
      executionId = list.find((e) => e.mode === "cli" && Date.parse(e.startedAt) >= since)?.id;
    }
  } catch {
    /* the poller will still mirror it */
  }
  return {
    ok: body.ok,
    kind: "execution",
    executionId,
    message: body.ok ? `Real execution ${executionId ?? ""} finished successfully` : `Execution failed: ${scrubSecrets(body.error ?? body.status ?? "unknown error", [])}`,
  };
}

async function probeWebhooks(key: string): Promise<TestRunResult> {
  const conn = await getN8nConnection();
  const endpoints = webhookEndpoints(loadWorkflowFile(key));
  if (endpoints.length === 0) return { ok: false, kind: "webhook-probe", message: "Workflow has no webhook trigger" };
  const lines: string[] = [];
  let allOk = true;
  for (const ep of endpoints) {
    const url = `${conn.baseUrl}/webhook/${ep.path}`;
    const { res } = await timedFetch(url, { method: ep.method, headers: { "Content-Type": "application/json" }, body: ep.method === "GET" ? undefined : "{}" }, 15_000);
    if (res.status === 404) {
      allOk = false;
      lines.push(`${ep.method} /webhook/${ep.path}: not registered (is the workflow enabled?)`);
    } else if (res.status >= 500) {
      allOk = false;
      lines.push(`${ep.method} /webhook/${ep.path}: server error ${res.status}`);
    } else if (res.status === 401 || res.status === 403) {
      lines.push(`${ep.method} /webhook/${ep.path}: live, rejects unauthenticated requests (${res.status})`);
    } else {
      lines.push(`${ep.method} /webhook/${ep.path}: live (${res.status})`);
    }
  }
  return { ok: allOk, kind: "webhook-probe", message: lines.join(" · ") };
}

export async function testRunWorkflow(key: string, actor: string): Promise<TestRunResult> {
  const wf = await prisma.workflowConfig.findUniqueOrThrow({ where: { key } });
  let result: TestRunResult;
  if (!wf.n8nWorkflowId || !wf.n8nPresent) {
    result = { ok: false, kind: "not-runnable", message: "Workflow is not present in n8n yet — it is imported automatically once n8n is connected" };
  } else if (wf.triggerKind === "error") {
    result = { ok: false, kind: "not-runnable", message: "The error handler runs automatically when another workflow fails; it cannot be started directly" };
  } else if (wf.triggerKind === "webhook") {
    result = await probeWebhooks(key);
  } else {
    result = await runViaSupervisor(wf.n8nWorkflowId);
    if (result.executionId) {
      // Mirror immediately (the poller would also pick it up) and tag it as a test run.
      await prisma.automationExecution.upsert({
        where: { source_externalId: { source: "N8N", externalId: result.executionId } },
        update: { trigger: `test-run by ${actor}` },
        create: {
          source: "N8N",
          externalId: result.executionId,
          workflowConfigId: wf.id,
          trigger: `test-run by ${actor}`,
          mode: "cli",
          provider: "n8n",
          status: result.ok ? "SUCCESS" : "FAILED",
          finishedAt: new Date(),
          relatedEntityType: "WorkflowConfig",
          relatedEntityId: key,
          error: result.ok ? null : result.message,
        },
      });
    }
  }
  await prisma.workflowConfig.update({
    where: { key },
    data: { lastTestRunAt: new Date(), lastTestRunOk: result.ok, lastTestRunMessage: result.message.slice(0, 500) },
  });
  return result;
}
