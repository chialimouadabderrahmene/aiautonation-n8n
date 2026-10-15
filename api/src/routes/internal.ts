import { Router, Request, Response, NextFunction } from "express";
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
