import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { prisma } from "../../lib/prisma";
import { n8nClient, N8nNode, N8nWorkflow } from "./client";
import { syncN8nCredentials } from "./credentials";
import { WORKFLOW_MANIFEST } from "../workflows/manifest";
import { recordAudit } from "../audit/audit";
import { logger } from "../../lib/logger";

/**
 * Idempotent import/reconcile of the 22 workflow files into n8n.
 *
 * - Every workflow is created INACTIVE. Nothing here ever activates a
 *   workflow the admin did not enable in the Control Center.
 * - Matching: stored n8n id first, then exact name — so redeploys, restarts
 *   and even a wiped Control Center database never create duplicates.
 * - Files are transformed on the way in (credentials rewired to the
 *   credentials the Control Center manages, error-handler reference
 *   resolved to 00's real id). The transformed definition is hashed; n8n is
 *   only updated when the hash changes.
 * - Drift: a workflow active in n8n but not enabled here is deactivated
 *   (the Control Center is the single source of truth for activation).
 */

const WORKFLOWS_DIR = process.env.WORKFLOWS_DIR ?? path.resolve(__dirname, "../../../../n8n-workflows");
const ERROR_HANDLER_KEY = "00-global-error-handler";
const FILE_ERROR_WORKFLOW_ID = "ekiwf00";

export interface WorkflowFile {
  id?: string;
  name: string;
  nodes: N8nNode[];
  connections: Record<string, unknown>;
  settings?: Record<string, unknown>;
}

export function loadWorkflowFile(key: string): WorkflowFile {
  return JSON.parse(fs.readFileSync(path.join(WORKFLOWS_DIR, `${key}.json`), "utf8")) as WorkflowFile;
}

export function workflowFilesAvailable(): string[] {
  try {
    return fs.readdirSync(WORKFLOWS_DIR).filter((f) => f.endsWith(".json")).map((f) => f.replace(/\.json$/, "")).sort();
  } catch {
    return [];
  }
}

export function detectTriggerKind(file: WorkflowFile): "manual" | "webhook" | "error" {
  const types = new Set(file.nodes.map((n) => n.type));
  if (types.has("n8n-nodes-base.errorTrigger")) return "error";
  if (types.has("n8n-nodes-base.manualTrigger")) return "manual";
  return "webhook";
}

export function webhookEndpoints(file: WorkflowFile): { path: string; method: string }[] {
  return file.nodes
    .filter((n) => n.type === "n8n-nodes-base.webhook")
    .map((n) => ({ path: String(n.parameters.path ?? ""), method: String(n.parameters.httpMethod ?? "GET") }));
}

/** n8n credential names a workflow needs AFTER transformation. */
export function requiredCredentialNames(file: WorkflowFile): string[] {
  const names = new Set<string>();
  for (const node of file.nodes) {
    for (const [type, ref] of Object.entries(node.credentials ?? {})) {
      const mapped = mapCredential(type, ref.name);
      if (mapped) names.add(mapped.name);
    }
  }
  return [...names].sort();
}

function mapCredential(type: string, name: string): { type: string; name: string } | null {
  if (type === "googleSheetsOAuth2Api") return { type: "googleApi", name: "Eki Google Sheets (Service Account)" };
  if (type === "telegramApi") return { type: "telegramApi", name: "Eki Telegram Bot" };
  if (type === "httpHeaderAuth" && (name === "Eki Webhook Shared Secret" || name === "Eki Telegram Webhook Secret")) return { type, name };
  if (type === "oAuth2Api" && /twitter|x oauth/i.test(name)) return { type: "httpHeaderAuth", name: "Eki X Bearer" };
  return null;
}

/** Pure transform: file → definition to send to n8n. Exported for tests. */
export function transformWorkflow(
  file: WorkflowFile,
  credentialIds: Record<string, string>,
  errorWorkflowId: string | null,
): Omit<N8nWorkflow, "id" | "active" | "updatedAt"> {
  const nodes = file.nodes.map((original) => {
    const node: N8nNode = JSON.parse(JSON.stringify(original));
    if (!node.credentials) return node;
    const creds: Record<string, { id: string; name: string }> = {};
    for (const [type, ref] of Object.entries(node.credentials)) {
      const mapped = mapCredential(type, ref.name);
      if (!mapped) {
        creds[type] = ref;
        continue;
      }
      if (type === "googleSheetsOAuth2Api") node.parameters = { ...node.parameters, authentication: "serviceAccount" };
      if (type === "oAuth2Api") node.parameters = { ...node.parameters, genericAuthType: "httpHeaderAuth" };
      const id = credentialIds[mapped.name];
      if (id) creds[mapped.type] = { id, name: mapped.name };
    }
    node.credentials = creds;
    if (Object.keys(creds).length === 0) delete node.credentials;
    return node;
  });

  const settings: Record<string, unknown> = { ...(file.settings ?? {}) };
  if (settings.errorWorkflow === FILE_ERROR_WORKFLOW_ID) {
    if (errorWorkflowId) settings.errorWorkflow = errorWorkflowId;
    else delete settings.errorWorkflow;
  }
  return { name: file.name, nodes, connections: file.connections, settings };
}

export function definitionHash(def: unknown): string {
  return crypto.createHash("sha256").update(JSON.stringify(def)).digest("hex").slice(0, 20);
}

export interface ReconcileReport {
  at: string;
  imported: string[];
  updated: string[];
  unchanged: string[];
  failed: { key: string; error: string }[];
  driftDeactivated: string[];
  duplicatesIgnored: { key: string; ids: string[] }[];
  present: number;
  active: number;
}

let running: Promise<ReconcileReport> | null = null;

/** Serialized — concurrent callers share one run. */
export function reconcileWorkflows(actor = "system"): Promise<ReconcileReport> {
  if (!running) {
    running = doReconcile(actor).finally(() => {
      running = null;
    });
  }
  return running;
}

async function doReconcile(actor: string): Promise<ReconcileReport> {
  const report: ReconcileReport = {
    at: new Date().toISOString(),
    imported: [],
    updated: [],
    unchanged: [],
    failed: [],
    driftDeactivated: [],
    duplicatesIgnored: [],
    present: 0,
    active: 0,
  };
  const credentialIds = await syncN8nCredentials();
  const live = (await n8nClient.listWorkflows()).filter((w) => !w.isArchived);
  const ordered = [...WORKFLOW_MANIFEST].sort((a, b) => (a.key === ERROR_HANDLER_KEY ? -1 : b.key === ERROR_HANDLER_KEY ? 1 : a.key.localeCompare(b.key)));
  let errorWorkflowId: string | null = null;

  for (const entry of ordered) {
    const row = await prisma.workflowConfig.findUnique({ where: { key: entry.key } });
    if (!row) continue;
    try {
      const file = loadWorkflowFile(entry.key);
      const byId = row.n8nWorkflowId ? live.find((w) => w.id === row.n8nWorkflowId) : undefined;
      const byName = live.filter((w) => w.name === file.name).sort((a, b) => a.updatedAt.localeCompare(b.updatedAt));
      const match = byId ?? byName[0];
      const dupes = byName.filter((w) => w.id !== match?.id);
      if (dupes.length) report.duplicatesIgnored.push({ key: entry.key, ids: dupes.map((d) => d.id) });

      const def = transformWorkflow(file, credentialIds, errorWorkflowId);
      const hash = definitionHash(def);
      let id: string;
      let active = false;
      if (!match) {
        const created = await n8nClient.createWorkflow(def);
        id = created.id;
        active = created.active;
        report.imported.push(entry.key);
        logger.info({ key: entry.key, id }, "[n8n] workflow imported (inactive)");
      } else {
        id = match.id;
        active = match.active;
        if (row.n8nDefinitionHash !== hash || row.n8nWorkflowId !== match.id) {
          const updated = await n8nClient.updateWorkflow(match.id, def);
          active = updated.active;
          report.updated.push(entry.key);
        } else {
          report.unchanged.push(entry.key);
        }
      }

      if (active && !row.enabled) {
        await n8nClient.deactivate(id);
        active = false;
        report.driftDeactivated.push(entry.key);
        await recordAudit(actor, "workflow.drift_deactivated", "WorkflowConfig", entry.key, { reason: "active in n8n but not enabled in the Control Center" });
      }

      if (entry.key === ERROR_HANDLER_KEY) errorWorkflowId = id;
      await prisma.workflowConfig.update({
        where: { key: entry.key },
        data: { n8nWorkflowId: id, n8nPresent: true, n8nActive: active, n8nSyncedAt: new Date(), n8nDefinitionHash: hash, triggerKind: detectTriggerKind(file) },
      });
      report.present += 1;
      if (active) report.active += 1;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      report.failed.push({ key: entry.key, error: message });
      await prisma.workflowConfig.update({ where: { key: entry.key }, data: { n8nPresent: false } });
      logger.error({ key: entry.key, err: message }, "[n8n] workflow reconcile failed");
    }
  }

  if (report.imported.length || report.updated.length || report.driftDeactivated.length || report.failed.length) {
    await recordAudit(actor, "n8n.workflows_reconciled", undefined, undefined, { ...report });
  }
  return report;
}

/** Marks every workflow as not present (used when n8n is unreachable, so
 * readiness never claims a workflow exists that we cannot see). */
export async function markAllWorkflowsUnknown(): Promise<void> {
  await prisma.workflowConfig.updateMany({ data: { n8nPresent: false, n8nActive: false } });
}
