import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { AuthedRequest } from "../modules/auth/auth";

export const campaignsRouter = Router();
campaignsRouter.get("/", async (_req, res) => res.json(await prisma.campaign.findMany({ orderBy: { createdAt: "desc" } })));
campaignsRouter.post("/", async (req: AuthedRequest, res) => {
  const p = z.object({ key: z.string().trim().min(1).max(80).regex(/^[a-z0-9_-]+$/), name: z.string().trim().min(1).max(120), description: z.string().max(500).optional() }).safeParse(req.body);
  if (!p.success) return res.status(400).json({ message: "Invalid campaign" });
  const campaign = await prisma.campaign.create({ data: p.data });
  res.status(201).json(campaign);
});
