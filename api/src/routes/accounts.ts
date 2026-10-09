import { Router } from "express";
import { z } from "zod";
import { AuthedRequest } from "../modules/auth/auth";
import { recordAudit } from "../modules/audit/audit";
import * as accounts from "../modules/accounts/service";
import { safeErrorMessage } from "../lib/http";

export const accountsRouter = Router();

accountsRouter.get("/", async (req, res) => {
  res.json(await accounts.listConnectedAccounts(typeof req.query.provider === "string" ? req.query.provider : undefined));
});

const captureSchema = z.object({ provider: z.string().min(1).max(40), label: z.string().trim().min(1).max(100) });

accountsRouter.post("/capture", async (req: AuthedRequest, res) => {
  const parsed = captureSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: parsed.error.issues[0]?.message ?? "Invalid body" });
  try {
    const row = await accounts.captureCurrentConnection(parsed.data.provider, parsed.data.label);
    await recordAudit(req.admin?.email ?? "unknown", "account.captured", "ConnectedAccount", row.id, { provider: parsed.data.provider, label: parsed.data.label });
    res.status(201).json(row);
  } catch (err) {
    res.status(400).json({ message: safeErrorMessage(err) });
  }
});

accountsRouter.put("/:id", async (req: AuthedRequest, res) => {
  const parsed = z.object({ label: z.string().trim().min(1).max(100) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: "label is required" });
  const row = await accounts.renameConnectedAccount(String(req.params.id), parsed.data.label);
  await recordAudit(req.admin?.email ?? "unknown", "account.renamed", "ConnectedAccount", row.id);
  res.json(row);
});

accountsRouter.post("/:id/default", async (req: AuthedRequest, res) => {
  await accounts.setDefaultConnectedAccount(String(req.params.id));
  await recordAudit(req.admin?.email ?? "unknown", "account.default_set", "ConnectedAccount", String(req.params.id));
  res.json({ ok: true });
});

accountsRouter.delete("/:id", async (req: AuthedRequest, res) => {
  await accounts.deleteConnectedAccount(String(req.params.id));
  await recordAudit(req.admin?.email ?? "unknown", "account.deleted", "ConnectedAccount", String(req.params.id));
  res.json({ ok: true });
});
