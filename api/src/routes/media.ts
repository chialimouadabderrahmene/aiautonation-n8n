import express, { Router } from "express";
import fs from "node:fs";
import crypto from "node:crypto";
import { prisma } from "../lib/prisma";
import { getStorage, localStoragePath, verifyLocalSignature } from "../lib/storage";
import { recordAudit } from "../modules/audit/audit";
import { AuthedRequest } from "../modules/auth/auth";

export const mediaRouter = Router();
/** Public, but every request must carry a valid, unexpired HMAC signature. */
export const mediaPublicRouter = Router();

const AUDIO_TYPES: Record<string, string> = {
  "audio/mpeg": "mp3",
  "audio/mp3": "mp3",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/aac": "aac",
  "audio/mp4": "m4a",
  "audio/x-m4a": "m4a",
};

mediaRouter.get("/music", async (_req, res) => {
  res.json(await prisma.mediaFile.findMany({ where: { kind: "MUSIC" }, orderBy: { createdAt: "desc" } }));
});

mediaRouter.post("/music", express.raw({ type: Object.keys(AUDIO_TYPES), limit: "25mb" }), async (req: AuthedRequest, res) => {
  const type = String(req.headers["content-type"] ?? "").split(";")[0]!.trim();
  const ext = AUDIO_TYPES[type];
  const name = String(req.query.name ?? "").trim().slice(0, 120);
  if (!ext) return res.status(415).json({ message: "Upload an MP3, WAV, AAC or M4A file" });
  if (!Buffer.isBuffer(req.body) || req.body.length === 0) return res.status(400).json({ message: "Empty file" });
  if (!name) return res.status(400).json({ message: "Give the track a name" });
  const storage = getStorage();
  if (storage.driver === "none") return res.status(409).json({ message: "Media storage is not configured" });

  const id = crypto.randomUUID();
  const key = `media/music/${id}.${ext}`;
  const { sizeBytes } = await storage.putBuffer(key, req.body, type);
  const file = await prisma.mediaFile.create({ data: { kind: "MUSIC", name, storageKey: key, mimeType: type, sizeBytes } });
  await recordAudit(req.admin?.email ?? "unknown", "media.music_uploaded", "MediaFile", file.id, { name, sizeBytes });
  res.status(201).json(file);
});

mediaRouter.get("/music/:id/url", async (req, res) => {
  const file = await prisma.mediaFile.findUnique({ where: { id: String(req.params.id) } });
  if (!file) return res.status(404).json({ message: "Not found" });
  res.json({ url: await getStorage().signedUrl(file.storageKey, 900) });
});

mediaRouter.delete("/music/:id", async (req: AuthedRequest, res) => {
  const file = await prisma.mediaFile.findUnique({ where: { id: String(req.params.id) } });
  if (!file) return res.status(404).json({ message: "Not found" });
  await getStorage().delete(file.storageKey).catch(() => undefined);
  await prisma.mediaFile.delete({ where: { id: file.id } });
  await recordAudit(req.admin?.email ?? "unknown", "media.music_deleted", "MediaFile", file.id);
  res.json({ ok: true });
});

const CONTENT_TYPES: Record<string, string> = { mp4: "video/mp4", mp3: "audio/mpeg", wav: "audio/wav", srt: "text/plain", m4a: "audio/mp4", aac: "audio/aac", jpg: "image/jpeg", png: "image/png" };

mediaPublicRouter.get("/local", (req, res) => {
  const key = String(req.query.key ?? "");
  const exp = Number(req.query.exp);
  const sig = String(req.query.sig ?? "");
  if (!key || !verifyLocalSignature(key, exp, sig)) return res.status(403).json({ message: "Link expired or invalid" });
  const file = localStoragePath(key);
  if (!file || !fs.existsSync(file)) return res.status(404).json({ message: "Not found" });
  const ext = key.split(".").pop()?.toLowerCase() ?? "";
  res.setHeader("Content-Type", CONTENT_TYPES[ext] ?? "application/octet-stream");
  res.setHeader("Cache-Control", "private, max-age=300");
  if (req.query.dl) res.setHeader("Content-Disposition", `attachment; filename="${String(req.query.dl).replace(/[^\w.-]+/g, "_")}"`);
  res.sendFile(file, { acceptRanges: true });
});
