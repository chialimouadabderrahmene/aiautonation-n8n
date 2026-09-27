import { Router, Request, Response, NextFunction } from "express";
import { computeN8nRuntimeEnv } from "../modules/n8n/runtimeEnv";
import { secretsEqual } from "../modules/telegram/telegram";

/**
 * Service-to-service endpoints, served ONLY on the internal listener
 * (INTERNAL_PORT — reachable over the private network, never through the
 * web proxy or a public domain) AND gated by INTERNAL_API_TOKEN.
 */
export const internalRouter = Router();

function requireInternalToken(req: Request, res: Response, next: NextFunction) {
  const expected = process.env.INTERNAL_API_TOKEN;
  const given = req.headers["x-internal-token"];
  if (!expected || expected.length < 24 || typeof given !== "string" || !secretsEqual(given, expected)) {
    res.status(403).json({ message: "Forbidden" });
    return;
  }
  next();
}

internalRouter.use(requireInternalToken);

/** Full runtime environment for the n8n supervisor (contains secrets — internal only). */
internalRouter.get("/n8n/runtime-env", async (_req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.json(await computeN8nRuntimeEnv());
});

/** Version hash only — polled every ~20 s by the supervisor. */
internalRouter.get("/n8n/runtime-env/version", async (_req, res) => {
  const { version } = await computeN8nRuntimeEnv();
  res.json({ version });
});
