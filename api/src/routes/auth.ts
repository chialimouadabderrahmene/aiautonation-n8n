import { Router } from "express";
import { z } from "zod";
import rateLimit from "express-rate-limit";
import bcrypt from "bcryptjs";
import { prisma } from "../lib/prisma";
import { login, requireAdmin, AuthedRequest } from "../modules/auth/auth";
import { recordAudit } from "../modules/audit/audit";

export const authRouter = Router();

// Only failed attempts count, so an admin who signs in often is never locked out
// while password guessing is still capped at 10 tries per 15 minutes per IP.
const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 10, standardHeaders: true, legacyHeaders: false, skipSuccessfulRequests: true });

const loginSchema = z.object({ email: z.string().email(), password: z.string().min(1).max(200) });

authRouter.post("/login", loginLimiter, async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: "Invalid credentials" });

  const result = await login(parsed.data.email.toLowerCase(), parsed.data.password);
  if (!result) {
    await recordAudit(parsed.data.email.toLowerCase(), "auth.login_failed");
    return res.status(401).json({ message: "Invalid email or password" });
  }
  await recordAudit(parsed.data.email.toLowerCase(), "auth.login");
  res.json(result);
});

authRouter.get("/me", requireAdmin, (req: AuthedRequest, res) => {
  res.json({ email: req.admin?.email });
});

const passwordSchema = z.object({ currentPassword: z.string().min(1), newPassword: z.string().min(12).max(200) });

authRouter.post("/password", requireAdmin, loginLimiter, async (req: AuthedRequest, res) => {
  const parsed = passwordSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: "New password must be at least 12 characters" });
  const user = await prisma.adminUser.findUnique({ where: { id: req.admin!.id } });
  if (!user || !(await bcrypt.compare(parsed.data.currentPassword, user.passwordHash))) {
    return res.status(401).json({ message: "Current password is wrong" });
  }
  await prisma.adminUser.update({ where: { id: user.id }, data: { passwordHash: await bcrypt.hash(parsed.data.newPassword, 12) } });
  await recordAudit(user.email, "auth.password_changed");
  res.json({ ok: true });
});
