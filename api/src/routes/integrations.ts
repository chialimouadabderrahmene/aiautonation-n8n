import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { PROVIDERS, getProvider } from "../modules/providers/registry";
import { saveCredentials, getDecryptedCredentials, disconnectIntegration, listIntegrationsMasked } from "../modules/integrations/vault";
import { recomputeAllReadiness } from "../modules/workflows/readiness";
import { recordAudit } from "../modules/audit/audit";
import { AuthedRequest } from "../modules/auth/auth";

export const integrationsRouter = Router();

integrationsRouter.get("/catalog", (_req, res) => {
  res.json(
    PROVIDERS.map((p) => ({
      key: p.key,
      label: p.label,
      category: p.category,
      description: p.description,
      caveat: p.caveat,
      fields: p.fields.map((f) => ({ name: f.name, label: f.label, secret: f.secret, required: f.required, placeholder: f.placeholder, default: f.default })),
    })),
  );
});

integrationsRouter.get("/", async (_req, res) => {
  res.json(await listIntegrationsMasked());
});

const saveSchema = z.object({
  secrets: z.record(z.string()).default({}),
  config: z.record(z.string()).default({}),
});

integrationsRouter.put("/:provider", async (req: AuthedRequest, res) => {
  const provider = req.params.provider as string;
  const def = getProvider(provider);
  if (!def) return res.status(404).json({ message: "Unknown provider" });
  const parsed = saveSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: "Invalid body", issues: parsed.error.issues });

  await saveCredentials({ provider: provider, secrets: parsed.data.secrets, config: parsed.data.config });
  await recomputeAllReadiness();
  await recordAudit(req.admin?.email ?? "unknown", "credential.saved", "Integration", provider);
  res.json({ ok: true });
});

integrationsRouter.post("/:provider/test", async (req: AuthedRequest, res) => {
  const provider = req.params.provider as string;
  const def = getProvider(provider);
  if (!def) return res.status(404).json({ message: "Unknown provider" });

  const creds = await getDecryptedCredentials(provider);
  if (!creds) return res.status(400).json({ message: "Not configured" });

  const missing = def.fields.filter((f) => f.required && f.secret && !creds.secrets[f.name]);
  if (missing.length > 0) {
    return res.status(400).json({ message: `Missing required field(s): ${missing.map((f) => f.label).join(", ")}` });
  }

  const result = await def.testConnection({ ...creds.secrets, ...creds.config });

  await prisma.integration.update({
    where: { provider: provider },
    data: {
      status: result.ok ? "CONNECTED" : "TEST_FAILED",
      lastTestedAt: new Date(),
      lastTestOk: result.ok,
      lastTestMessage: result.message,
      lastTestLatencyMs: result.latencyMs,
    },
  });
  await recomputeAllReadiness();
  await recordAudit(req.admin?.email ?? "unknown", "credential.tested", "Integration", provider, {
    ok: result.ok,
    latencyMs: result.latencyMs,
  });

  res.json(result);
});

integrationsRouter.delete("/:provider", async (req: AuthedRequest, res) => {
  const provider = req.params.provider as string;
  await disconnectIntegration(provider);
  await recomputeAllReadiness();
  await recordAudit(req.admin?.email ?? "unknown", "integration.disconnected", "Integration", provider);
  res.json({ ok: true });
});
