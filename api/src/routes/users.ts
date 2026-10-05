import { Router } from "express";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { prisma } from "../lib/prisma";
import { AuthedRequest, requireOwner } from "../modules/auth/auth";
import { recordAudit } from "../modules/audit/audit";

export const usersRouter = Router();

usersRouter.get("/", async (_req, res) => {
  const users = await prisma.adminUser.findMany({ select: { id: true, email: true, role: true, createdAt: true, lastLoginAt: true }, orderBy: { createdAt: "asc" } });
  res.json(users);
});

const createSchema = z.object({ email: z.string().email(), password: z.string().min(12).max(200), role: z.enum(["OWNER", "ADMIN", "VIEWER"]).default("ADMIN") });

usersRouter.post("/", requireOwner, async (req: AuthedRequest, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: parsed.error.issues[0]?.message ?? "Invalid body" });
  const email = parsed.data.email.toLowerCase();
  if (await prisma.adminUser.findUnique({ where: { email } })) return res.status(409).json({ message: "A user with that email already exists" });
  const user = await prisma.adminUser.create({ data: { email, passwordHash: await bcrypt.hash(parsed.data.password, 12), role: parsed.data.role } });
  await recordAudit(req.admin?.email ?? "unknown", "user.created", "AdminUser", user.id, { email, role: parsed.data.role });
  res.status(201).json({ id: user.id, email: user.email, role: user.role });
});

const roleSchema = z.object({ role: z.enum(["OWNER", "ADMIN", "VIEWER"]) });

usersRouter.put("/:id/role", requireOwner, async (req: AuthedRequest, res) => {
  const parsed = roleSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: "role must be OWNER, ADMIN or VIEWER" });
  if (req.params.id === req.admin?.id && parsed.data.role !== "OWNER") {
    const owners = await prisma.adminUser.count({ where: { role: "OWNER" } });
    if (owners <= 1) return res.status(409).json({ message: "Cannot demote the last Owner" });
  }
  const user = await prisma.adminUser.update({ where: { id: String(req.params.id) }, data: { role: parsed.data.role } });
  await recordAudit(req.admin?.email ?? "unknown", "user.role_changed", "AdminUser", user.id, { role: parsed.data.role });
  res.json({ id: user.id, email: user.email, role: user.role });
});

usersRouter.delete("/:id", requireOwner, async (req: AuthedRequest, res) => {
  if (req.params.id === req.admin?.id) return res.status(409).json({ message: "Cannot remove your own account" });
  const target = await prisma.adminUser.findUnique({ where: { id: String(req.params.id) } });
  if (target?.role === "OWNER" && (await prisma.adminUser.count({ where: { role: "OWNER" } })) <= 1) {
    return res.status(409).json({ message: "Cannot remove the last Owner" });
  }
  await prisma.adminUser.delete({ where: { id: String(req.params.id) } });
  await recordAudit(req.admin?.email ?? "unknown", "user.removed", "AdminUser", String(req.params.id));
  res.json({ ok: true });
});
