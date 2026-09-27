import { Router } from "express";
import { prisma } from "../lib/prisma";

export const auditRouter = Router();

auditRouter.get("/", async (_req, res) => {
  const logs = await prisma.auditLog.findMany({ orderBy: { createdAt: "desc" }, take: 300 });
  res.json(logs);
});
