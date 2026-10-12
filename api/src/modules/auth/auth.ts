import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { Request, Response, NextFunction } from "express";
import { prisma } from "../../lib/prisma";
import { logger } from "../../lib/logger";

function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < 16) {
    throw new Error("JWT_SECRET is not set (or too short) — set a random server-side secret.");
  }
  return secret;
}

/** Creates the single operator account on first boot if none exists and
 * ADMIN_BOOTSTRAP_EMAIL/PASSWORD are set. This is a standalone control
 * center with no self-service signup — intentionally minimal. */
export async function bootstrapAdmin(): Promise<void> {
  const existing = await prisma.adminUser.count();
  if (existing > 0) return;
  const email = process.env.ADMIN_BOOTSTRAP_EMAIL;
  const password = process.env.ADMIN_BOOTSTRAP_PASSWORD;
  if (!email || !password) return;
  const passwordHash = await bcrypt.hash(password, 12);
  await prisma.adminUser.create({ data: { email: email.toLowerCase(), passwordHash } });
  logger.info({ email: email.toLowerCase() }, "[auth] bootstrapped admin account");
}

export async function login(email: string, password: string): Promise<{ token: string } | null> {
  const user = await prisma.adminUser.findUnique({ where: { email } });
  if (!user) return null;
  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) return null;
  await prisma.adminUser.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  const token = jwt.sign({ sub: user.id, email: user.email, role: user.role }, getJwtSecret(), { expiresIn: "12h" });
  return { token };
}

export type AdminRole = "OWNER" | "ADMIN" | "VIEWER";

export interface AuthedRequest extends Request {
  admin?: { id: string; email: string; role: AdminRole };
}

export function requireAdmin(req: AuthedRequest, res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    res.status(401).json({ message: "Unauthorized" });
    return;
  }
  try {
    const payload = jwt.verify(header.slice(7), getJwtSecret()) as { sub: string; email: string; role?: AdminRole };
    // A token minted before roles existed carries no `role` claim — treat it
    // as OWNER (the only role that existed then) rather than locking out
    // every session on deploy; it naturally re-mints with a role on next login.
    req.admin = { id: payload.sub, email: payload.email, role: payload.role ?? "OWNER" };
    next();
  } catch {
    res.status(401).json({ message: "Unauthorized" });
  }
}

/**
 * Server-side RBAC gate: VIEWER may GET/HEAD anything requireAdmin already
 * protects, never write. Mount once, after requireAdmin, on every router
 * that performs writes — not a per-route annotation someone can forget.
 */
export function requireWrite(req: AuthedRequest, res: Response, next: NextFunction): void {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
  if (req.admin?.role === "VIEWER") {
    res.status(403).json({ message: "Your role (Viewer) is read-only" });
    return;
  }
  next();
}

/** OWNER-only gate, for user management itself. */
export function requireOwner(req: AuthedRequest, res: Response, next: NextFunction): void {
  if (req.admin?.role !== "OWNER") {
    res.status(403).json({ message: "Only an Owner can manage team members" });
    return;
  }
  next();
}
