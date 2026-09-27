import { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { WORKFLOW_MANIFEST } from "./manifest";
import { getProvider } from "../providers/registry";
import { getAllSettings, getSettingDefinition } from "../settings/schema";
import { checkWorker, checkStorage } from "../system/health";
import { loadWorkflowFile, requiredCredentialNames, workflowFilesAvailable } from "../n8n/workflows";
import { MANAGED_CREDENTIALS } from "../n8n/credentials";

/**
 * The readiness engine. A workflow is READY only when every requirement is
 * verifiably met right now:
 *   - each required provider is CONNECTED (configured AND its last real test passed)
 *   - required business settings / provider fields are filled in
 *   - required human confirmations are ticked
 *   - n8n is connected, the workflow exists in n8n, and every n8n credential
 *     it uses has been synced from the vault
 *   - (video) a live worker with ffmpeg/ffprobe and reachable storage
 * Anything else is BLOCKED (or ACTION_REQUIRED when the only gaps are human
 * confirmations), with one line per unmet requirement naming the fix.
 */

export interface ReadinessDetail {
  requirement: string;
  label: string;
  ok: boolean;
  note?: string;
}

export interface ReadinessResult {
  readiness: "READY" | "BLOCKED" | "ACTION_REQUIRED";
  detail: ReadinessDetail[];
}

interface Snapshot {
  integrations: Map<string, { status: string; config: Record<string, string>; lastTestMessage: string | null; n8nCredentialIds: Record<string, { id: string }> }>;
  settings: Record<string, unknown>;
  workerOk: { ok: boolean; message: string } | null;
  storageOk: { ok: boolean; message: string } | null;
  telegramWebhook: string | null;
}

const STATUS_TEXT: Record<string, string> = {
  NOT_CONFIGURED: "is not configured",
  CONFIGURED: "is configured but not tested yet — click Test connection",
  TEST_FAILED: "failed its connection test",
  ACTION_REQUIRED: "needs attention",
};

function label(provider: string): string {
  return getProvider(provider)?.label ?? provider;
}

export async function takeSnapshot(opts: { includeInfra?: boolean } = {}): Promise<Snapshot> {
  const rows = await prisma.integration.findMany();
  const integrations = new Map(
    rows.map((r) => [
      r.provider,
      {
        status: r.status,
        config: (r.config as Record<string, string>) ?? {},
        lastTestMessage: r.lastTestMessage,
        n8nCredentialIds: (r.n8nCredentialIds as Record<string, { id: string }>) ?? {},
      },
    ]),
  );
  const settings = await getAllSettings();
  const tgRow = await prisma.setting.findUnique({ where: { key: "_telegramWebhookUrl" } });
  let workerOk: Snapshot["workerOk"] = null;
  let storageOk: Snapshot["storageOk"] = null;
  if (opts.includeInfra) {
    const [w, s] = await Promise.all([checkWorker(), checkStorage()]);
    workerOk = { ok: w.status === "ONLINE", message: w.message };
    storageOk = { ok: s.status === "ONLINE" || s.status === "DEGRADED", message: s.message };
  }
  return { integrations, settings, workerOk, storageOk, telegramWebhook: typeof tgRow?.value === "string" ? tgRow.value : null };
}

function checkOne(requirement: string, snap: Snapshot): ReadinessDetail {
  if (requirement.includes("|")) {
    const options = requirement.split("|");
    const ok = options.some((o) => snap.integrations.get(o)?.status === "CONNECTED");
    const names = options.map(label).join(" or ");
    return { requirement, label: names, ok, note: ok ? undefined : `Connect and test ${names} in Integrations` };
  }
  if (requirement.startsWith("setting:")) {
    const key = requirement.slice(8);
    const ok = snap.settings[key] === true;
    return { requirement, label: getSettingDefinition(key)?.label ?? key, ok, note: ok ? undefined : "Confirm this in Settings (cannot be verified automatically)" };
  }
  if (requirement.startsWith("config:")) {
    const key = requirement.slice(7);
    const v = snap.settings[key];
    const ok = v !== undefined && v !== null && String(v).trim() !== "";
    const name = getSettingDefinition(key)?.label ?? key;
    return { requirement, label: name, ok, note: ok ? undefined : `Fill in "${name}" in Settings` };
  }
  if (requirement.startsWith("field:")) {
    const [provider, field] = requirement.slice(6).split(".") as [string, string];
    const def = getProvider(provider)?.fields.find((f) => f.name === field);
    const ok = Boolean(snap.integrations.get(provider)?.config[field]);
    return { requirement, label: `${label(provider)}: ${def?.label ?? field}`, ok, note: ok ? undefined : `Fill in "${def?.label ?? field}" on the ${label(provider)} card in Integrations` };
  }
  if (requirement === "telegram:webhook") {
    const ok = Boolean(snap.telegramWebhook);
    return { requirement, label: "Telegram buttons/commands routed to the Control Center", ok, note: ok ? undefined : "Registered automatically after Telegram passes its test (needs PUBLIC_WEB_URL on the API service)" };
  }
  if (requirement === "worker:ffmpeg") {
    const ok = snap.workerOk?.ok ?? false;
    return { requirement, label: "Video worker with FFmpeg", ok, note: ok ? undefined : snap.workerOk?.message ?? "Worker status unknown" };
  }
  if (requirement === "storage") {
    const ok = snap.storageOk?.ok ?? false;
    return { requirement, label: "Media storage", ok, note: ok ? undefined : snap.storageOk?.message ?? "Storage status unknown" };
  }
  const integration = snap.integrations.get(requirement);
  const status = integration?.status ?? "NOT_CONFIGURED";
  const ok = status === "CONNECTED";
  const reason = status === "TEST_FAILED" && integration?.lastTestMessage ? `failed its test: ${integration.lastTestMessage}` : STATUS_TEXT[status] ?? status;
  return { requirement, label: label(requirement), ok, note: ok ? undefined : `${label(requirement)} ${reason}` };
}

function classify(detail: ReadinessDetail[]): ReadinessResult["readiness"] {
  const failing = detail.filter((d) => !d.ok);
  if (failing.length === 0) return "READY";
  return failing.every((d) => d.requirement.startsWith("setting:")) ? "ACTION_REQUIRED" : "BLOCKED";
}

export async function evaluateRequirements(required: string[], snap?: Snapshot): Promise<ReadinessResult> {
  const needsInfra = required.some((r) => r === "worker:ffmpeg" || r === "storage");
  const s = snap ?? (await takeSnapshot({ includeInfra: needsInfra }));
  const detail = required.map((r) => checkOne(r, s));
  return { readiness: classify(detail), detail };
}

function n8nChecks(key: string, wf: { n8nPresent: boolean; n8nWorkflowId: string | null }, snap: Snapshot): ReadinessDetail[] {
  const out: ReadinessDetail[] = [];
  const n8n = snap.integrations.get("n8n");
  const n8nOk = n8n?.status === "CONNECTED";
  out.push({ requirement: "n8n", label: "n8n connected", ok: n8nOk, note: n8nOk ? undefined : `n8n ${STATUS_TEXT[n8n?.status ?? "NOT_CONFIGURED"] ?? "is not connected"}` });
  out.push({
    requirement: "n8n:workflow",
    label: "Workflow imported into n8n",
    ok: n8nOk && wf.n8nPresent && Boolean(wf.n8nWorkflowId),
    note: wf.n8nPresent ? undefined : "Not found in n8n yet — it is imported automatically once n8n is connected",
  });
  let credNames: string[] = [];
  try {
    credNames = requiredCredentialNames(loadWorkflowFile(key));
  } catch {
    out.push({ requirement: "n8n:file", label: "Workflow definition file", ok: false, note: "Workflow file missing from the API image" });
  }
  for (const name of credNames) {
    const spec = MANAGED_CREDENTIALS.find((c) => c.name === name);
    const synced = spec ? Boolean(snap.integrations.get(spec.source)?.n8nCredentialIds[name]?.id) : false;
    out.push({
      requirement: `n8n:credential:${name}`,
      label: `n8n credential "${name}"`,
      ok: synced,
      note: synced ? undefined : spec ? `Created in n8n automatically once ${label(spec.source)} is configured` : "Unmanaged credential",
    });
  }
  return out;
}

/** Re-seeds WorkflowConfig from the manifest (idempotent) and recomputes
 * every workflow's readiness. Call after any integration/setting change and
 * before any activation. */
export async function recomputeAllReadiness(): Promise<void> {
  const snap = await takeSnapshot();
  const files = new Set(workflowFilesAvailable());
  for (const entry of WORKFLOW_MANIFEST) {
    const wf = await prisma.workflowConfig.upsert({
      where: { key: entry.key },
      update: { name: entry.name, category: entry.category, requiredProviders: entry.required, optionalProviders: entry.optional ?? [] },
      create: { key: entry.key, name: entry.name, category: entry.category, requiredProviders: entry.required, optionalProviders: entry.optional ?? [] },
    });
    const own = entry.required.map((r) => checkOne(r, snap));
    const infra = files.has(entry.key) ? n8nChecks(entry.key, wf, snap) : [{ requirement: "n8n:file", label: "Workflow definition file", ok: false, note: "Workflow file missing" }];
    const detail = [...own, ...infra];
    await prisma.workflowConfig.update({
      where: { key: entry.key },
      data: { readiness: classify(detail), readinessDetail: detail as unknown as Prisma.InputJsonValue },
    });
  }
}
