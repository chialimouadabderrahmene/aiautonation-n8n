import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { PROVIDERS, getProvider, publicProviderSchema, validateProviderInput } from "../modules/providers/registry";
import {
  saveCredentials,
  getProviderValues,
  disconnectIntegration,
  disconnectOAuthAccount,
  listIntegrationsMasked,
  recordTestResult,
  rotateGeneratedSecret,
  CredentialsUnreadableError,
} from "../modules/integrations/vault";
import { recomputeAllReadiness } from "../modules/workflows/readiness";
import { recordAudit } from "../modules/audit/audit";
import { AuthedRequest } from "../modules/auth/auth";
import { startOAuth, completeOAuth, oauthRedirectUri, publicWebUrl } from "../modules/oauth/oauth";
import { requestN8nSync } from "../modules/system/scheduler";
import { ensureTelegramWebhook, clearTelegramWebhookState } from "../modules/telegram/telegram";
import { safeErrorMessage } from "../lib/http";

export const integrationsRouter = Router();
/** Public: OAuth providers redirect the admin's browser here. */
export const oauthPublicRouter = Router();

async function afterChange(provider: string, tested: boolean) {
  await recomputeAllReadiness();
  requestN8nSync();
  if (provider === "telegram") {
    if (tested) await ensureTelegramWebhook();
    else await clearTelegramWebhookState();
    await recomputeAllReadiness();
  }
}

integrationsRouter.get("/catalog", (_req, res) => {
  res.json(PROVIDERS.map(publicProviderSchema));
});

integrationsRouter.get("/", async (_req, res) => {
  const list = await listIntegrationsMasked();
  res.json(list.map((i) => ({ ...i, oauthRedirectUri: i.authType === "OAUTH" ? oauthRedirectUri(i.provider) : undefined })));
});

const saveSchema = z.object({
  secrets: z.record(z.string().max(20_000)).default({}),
  config: z.record(z.string().max(5_000)).default({}),
});

integrationsRouter.put("/:provider", async (req: AuthedRequest, res) => {
  const provider = String(req.params.provider);
  const def = getProvider(provider);
  if (!def) return res.status(404).json({ message: "Unknown provider" });
  const parsed = saveSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: "Invalid body" });

  const row = await prisma.integration.findUnique({ where: { provider }, include: { credentials: { select: { fieldName: true } } } });
  const stored = new Set(row?.credentials.map((c) => c.fieldName) ?? []);
  const nonEmptySecrets = Object.fromEntries(Object.entries(parsed.data.secrets).filter(([, v]) => v.trim() !== ""));
  const errors = validateProviderInput(def, nonEmptySecrets, parsed.data.config, stored);
  if (errors.length) return res.status(400).json({ message: errors.map((e) => e.message).join("; "), errors });

  await saveCredentials({ provider, secrets: nonEmptySecrets, config: parsed.data.config });
  await recordAudit(req.admin?.email ?? "unknown", "credential.saved", "Integration", provider, {
    secretFieldsChanged: Object.keys(nonEmptySecrets),
    configFieldsChanged: Object.keys(parsed.data.config),
  });
  await afterChange(provider, false);
  res.json({ ok: true, status: "CONFIGURED" });
});

integrationsRouter.post("/:provider/test", async (req: AuthedRequest, res) => {
  const provider = String(req.params.provider);
  const def = getProvider(provider);
  if (!def) return res.status(404).json({ message: "Unknown provider" });

  let values: Record<string, string> | null;
  try {
    values = await getProviderValues(provider);
  } catch (err) {
    if (err instanceof CredentialsUnreadableError) {
      await prisma.integration.update({ where: { provider }, data: { status: "ACTION_REQUIRED", lastTestMessage: err.message } });
      return res.status(409).json({ ok: false, message: err.message });
    }
    throw err;
  }
  const missing = def.fields.filter((f) => f.required && !values?.[f.name]);
  if (missing.length > 0) {
    return res.status(400).json({ ok: false, message: `Missing required field(s): ${missing.map((f) => f.label).join(", ")}` });
  }
  if (def.oauth && !values?.accessToken && !values?.pageAccessToken) {
    return res.status(400).json({ ok: false, message: "Click “Connect account” first — no account is linked yet" });
  }

  await prisma.integration.update({ where: { provider }, data: { lastTestMessage: "Testing…" } });
  const result = await def.testConnection(values ?? {});
  await recordTestResult(provider, result);
  await recordAudit(req.admin?.email ?? "unknown", "credential.tested", "Integration", provider, { ok: result.ok, latencyMs: result.latencyMs, message: result.message });
  await afterChange(provider, result.ok);
  res.json(result);
});

integrationsRouter.post("/:provider/secrets/:field/rotate", async (req: AuthedRequest, res) => {
  const provider = String(req.params.provider);
  const field = String(req.params.field);
  try {
    const value = await rotateGeneratedSecret(provider, field);
    await recordAudit(req.admin?.email ?? "unknown", "credential.rotated", "Integration", provider, { field });
    await afterChange(provider, false);
    // The only response in the API that contains a secret: shown once so the
    // admin can paste it into the system that must send it.
    res.json({ ok: true, value, notice: "Copy this now — it will not be shown again." });
  } catch (err) {
    res.status(400).json({ message: safeErrorMessage(err) });
  }
});

integrationsRouter.post("/:provider/oauth/start", async (req: AuthedRequest, res) => {
  const provider = String(req.params.provider);
  try {
    const { authorizeUrl } = await startOAuth(provider);
    await recordAudit(req.admin?.email ?? "unknown", "oauth.started", "Integration", provider);
    res.json({ authorizeUrl });
  } catch (err) {
    res.status(400).json({ message: safeErrorMessage(err) });
  }
});

integrationsRouter.post("/:provider/oauth/disconnect", async (req: AuthedRequest, res) => {
  const provider = String(req.params.provider);
  if (!getProvider(provider)?.oauth) return res.status(404).json({ message: "Not an OAuth provider" });
  await disconnectOAuthAccount(provider);
  await recordAudit(req.admin?.email ?? "unknown", "oauth.disconnected", "Integration", provider);
  await afterChange(provider, false);
  res.json({ ok: true });
});

integrationsRouter.delete("/:provider", async (req: AuthedRequest, res) => {
  const provider = String(req.params.provider);
  if (!getProvider(provider)) return res.status(404).json({ message: "Unknown provider" });
  await disconnectIntegration(provider);
  await recordAudit(req.admin?.email ?? "unknown", "integration.disconnected", "Integration", provider);
  await afterChange(provider, false);
  res.json({ ok: true });
});

oauthPublicRouter.get("/callback/:provider", async (req, res) => {
  const provider = String(req.params.provider);
  const back = (params: Record<string, string>) => `${publicWebUrl() ?? ""}/integrations?${new URLSearchParams({ oauth: provider, ...params }).toString()}`;
  const { code, state, error, error_description } = req.query as Record<string, string | undefined>;
  if (error) return res.redirect(back({ result: "error", message: String(error_description ?? error).slice(0, 200) }));
  if (!code || !state) return res.redirect(back({ result: "error", message: "Missing code/state" }));
  const outcome = await completeOAuth(provider, state, code);
  await recordAudit("oauth-callback", outcome.ok ? "oauth.connected" : "oauth.failed", "Integration", provider, { account: outcome.account, message: outcome.message });
  await afterChange(provider, outcome.ok);
  res.redirect(back({ result: outcome.ok ? "ok" : "error", message: outcome.message.slice(0, 200) }));
});
