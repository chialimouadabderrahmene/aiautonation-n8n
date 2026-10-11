import { Router } from "express";
import rateLimit from "express-rate-limit";
import { runWebhookTrigger } from "../modules/engine/webhooks";

// Public internet endpoint — bound generously (form submissions, not an API a client polls)
// but never unbounded, mirroring routes/auth.ts's own public-route limiter.
const hooksLimiter = rateLimit({ windowMs: 60_000, max: 30, standardHeaders: true, legacyHeaders: false });

/**
 * Public ingestion for WEBHOOK-triggered native workflows — the native replacement for n8n's
 * webhook nodes (03-lead-capture-webhook, 04-waitlist-management, 07-referral-campaign,
 * 08-feedback-collection). Mounted UNAUTHENTICATED at /api/hooks/:workflowKey (see app.ts) —
 * same trust model as those n8n webhooks had (public internet, no secret), input is always
 * Zod-validated by the first action step before anything is trusted.
 */
export const hooksRouter = Router();

hooksRouter.post("/:workflowKey", hooksLimiter, async (req, res) => {
  const result = await runWebhookTrigger(String(req.params.workflowKey), req.body ?? {});
  if (result.ok) return res.status(200).json({ ok: true, executionId: result.executionId, result: result.context });
  const code = result.status === "NOT_FOUND" ? 404 : result.status === "DISABLED" ? 409 : 400;
  res.status(code).json({ ok: false, message: result.message, executionId: result.executionId });
});
