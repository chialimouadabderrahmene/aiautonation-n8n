import crypto from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { getProviderValues } from "../modules/integrations/vault";
import { runSignupProcessing } from "../modules/signups/processor";

export const attributionPublicRouter = Router();
export const attributionRouter = Router();
export const attributionEventSchema = z.object({ eventId: z.string().trim().min(1).max(160), eventType: z.enum(["lead_captured", "registration", "vendor_activated"]), leadId: z.string().trim().max(160).optional(), vendorId: z.string().trim().max(160).optional(), campaignId: z.string().cuid().optional(), source: z.string().trim().max(80).optional(), medium: z.string().trim().max(80).optional(), campaignName: z.string().trim().max(120).optional(), content: z.string().trim().max(120).optional(), term: z.string().trim().max(120).optional(), occurredAt: z.string().datetime().optional(), metadata: z.record(z.unknown()).default({}) });
async function ingest(body: unknown) {
  const parsed = attributionEventSchema.parse(body);
  const row = await prisma.attributionEvent.upsert({ where: { eventId: parsed.eventId }, update: {}, create: { ...parsed, occurredAt: parsed.occurredAt ? new Date(parsed.occurredAt) : new Date(), metadata: parsed.metadata as Prisma.InputJsonValue } });
  return row;
}

attributionPublicRouter.post("/events", async (req, res) => {
  const supplied = req.headers["x-eki-webhook-secret"];
  const configured = (await getProviderValues("webhooks"))?.sharedSecret;
  if (typeof supplied !== "string" || !configured || supplied.length !== configured.length || !crypto.timingSafeEqual(Buffer.from(supplied), Buffer.from(configured))) return res.status(401).json({ message: "Unauthorized" });
  let row;
  try { row = await ingest(req.body); } catch (error) { return res.status(400).json({ message: error instanceof Error ? error.message : "Invalid event" }); }
  if (row.eventType === "registration") void runSignupProcessing();
  return res.status(202).json(row);
});

attributionRouter.get("/events", async (req, res) => res.json(await prisma.attributionEvent.findMany({ where: { eventType: typeof req.query.eventType === "string" ? req.query.eventType : undefined }, orderBy: { occurredAt: "desc" }, take: 200 })));
