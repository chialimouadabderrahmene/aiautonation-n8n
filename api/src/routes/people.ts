import { Router } from "express";
import { prisma } from "../lib/prisma";

/** Everyone who has come in, with their WhatsApp conversation, newest activity first. */
export const peopleRouter = Router();

peopleRouter.get("/", async (req, res) => {
  const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
  const leads = await prisma.engineLead.findMany({
    where: q ? { OR: [{ name: { contains: q, mode: "insensitive" } }, { phone: { contains: q } }, { market: { contains: q, mode: "insensitive" } }] } : undefined,
    orderBy: { updatedAt: "desc" },
    take: 100,
  });
  const lastMessages = await prisma.engineWhatsAppConversation.findMany({
    where: { phone: { in: leads.map((l) => l.phone) } },
    orderBy: { createdAt: "desc" },
    distinct: ["phone"],
  });
  const lastByPhone = new Map(lastMessages.map((m) => [m.phone, m]));
  res.json(
    leads.map((l) => {
      const last = lastByPhone.get(l.phone);
      return {
        id: l.id, name: l.name, phone: l.phone, market: l.market, source: l.source, type: l.leadType, status: l.status, hot: l.highIntent, optIn: l.whatsappOptIn,
        createdAt: l.createdAt, lastMessage: last?.messageText ?? null, lastAt: last?.createdAt ?? l.createdAt,
      };
    }),
  );
});

peopleRouter.get("/:id", async (req, res) => {
  const lead = await prisma.engineLead.findUnique({ where: { id: String(req.params.id) } });
  if (!lead) return res.status(404).json({ message: "Person not found" });
  const conversation = await prisma.engineWhatsAppConversation.findMany({ where: { phone: lead.phone }, orderBy: { createdAt: "asc" } });
  res.json({ ...lead, conversation });
});
