/**
 * Verifies the n8n state DIRECTLY through n8n's public API, using the API key
 * the Control Center provisioned for itself (read from the encrypted vault).
 * Prints counts and names only — never a key or credential value.
 *
 *   node dist/tools/n8n-verify.js            (inside the api container, e.g.
 *   railway ssh --service api -- node dist/tools/n8n-verify.js)
 *
 * Exit code 0 when: n8n reachable, an owner exists, all 22 Control Center
 * workflows are present exactly once, and no workflow is active that the
 * Control Center has not enabled.
 */
import "dotenv/config";
import { prisma } from "../lib/prisma";
import { getN8nConnection } from "../modules/n8n/client";
import { MANAGED_CREDENTIALS } from "../modules/n8n/credentials";
import { loadWorkflowFile } from "../modules/n8n/workflows";
import { WORKFLOW_MANIFEST } from "../modules/workflows/manifest";

async function get<T>(path: string): Promise<T> {
  const conn = await getN8nConnection();
  const all: unknown[] = [];
  let cursor: string | null | undefined;
  for (let i = 0; i < 20; i++) {
    const sep = path.includes("?") ? "&" : "?";
    const res = await fetch(`${conn.baseUrl}/api/v1${path}${sep}limit=250${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`, {
      headers: { "X-N8N-API-KEY": conn.apiKey, Accept: "application/json" },
    });
    if (!res.ok) throw new Error(`n8n ${path} responded ${res.status}`);
    const body = (await res.json()) as { data: unknown[]; nextCursor?: string | null };
    all.push(...body.data);
    cursor = body.nextCursor;
    if (!cursor) break;
  }
  return all as T;
}

async function main() {
  const conn = await getN8nConnection();
  const workflows = (await get<{ id: string; name: string; active: boolean; isArchived?: boolean }[]>("/workflows")).filter((w) => !w.isArchived);
  const users = await get<{ email: string; role?: string }[]>("/users?includeRole=true").catch(() => []);
  const credentials = await get<{ name: string; type: string }[]>("/credentials");
  const configs = await prisma.workflowConfig.findMany({ select: { key: true, enabled: true, n8nWorkflowId: true } });

  const expectedNames = WORKFLOW_MANIFEST.map((m) => loadWorkflowFile(m.key).name);
  const byName = new Map<string, number>();
  for (const w of workflows) byName.set(w.name, (byName.get(w.name) ?? 0) + 1);
  const present = expectedNames.filter((n) => (byName.get(n) ?? 0) >= 1);
  const duplicates = expectedNames.filter((n) => (byName.get(n) ?? 0) > 1);
  const missing = expectedNames.filter((n) => !byName.get(n));
  const enabledIds = new Set(configs.filter((c) => c.enabled).map((c) => c.n8nWorkflowId));
  const active = workflows.filter((w) => w.active);
  const unexpectedActive = active.filter((w) => !enabledIds.has(w.id)).map((w) => w.name);
  const managedCredNames = MANAGED_CREDENTIALS.map((c) => c.name);

  const report = {
    n8nBaseUrl: conn.baseUrl,
    owner: users.filter((u) => /owner/i.test(u.role ?? "")).map((u) => u.email),
    workflowsInN8n: workflows.length,
    controlCenterWorkflowsPresent: `${present.length}/${expectedNames.length}`,
    missing,
    duplicates,
    active: active.length,
    unexpectedlyActive: unexpectedActive,
    managedCredentialsPresent: managedCredNames.filter((n) => credentials.some((c) => c.name === n)),
    managedCredentialsNotYetCreated: managedCredNames.filter((n) => !credentials.some((c) => c.name === n)),
  };
  console.log(JSON.stringify(report, null, 2));
  const ok = report.owner.length > 0 && missing.length === 0 && duplicates.length === 0 && unexpectedActive.length === 0;
  await prisma.$disconnect();
  process.exitCode = ok ? 0 : 1;
}

main().catch(async (err) => {
  console.error(`[n8n-verify] FAILED: ${err instanceof Error ? err.message : String(err)}`);
  await prisma.$disconnect().catch(() => undefined);
  process.exit(1);
});
