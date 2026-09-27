#!/usr/bin/env node
/**
 * LOCAL TEST TOOL — never deployed to production.
 *
 * A mock of the provider APIs the Control Center calls (OpenAI, Runway,
 * ElevenLabs, Telegram, Meta), shaped after each provider's documented
 * request/response format, used by docker/docker-compose.test.yml to run the
 * complete video pipeline (script → voice → scenes → FFmpeg → QA → storage
 * → Telegram approval → publish) in environments where the real providers
 * are unreachable. Media is generated with FFmpeg test patterns, so every
 * file the pipeline handles is a real, playable file.
 *
 * Validation mirrors the real APIs where it matters (Runway model/ratio/
 * duration constraints from @runwayml/sdk, promptText ≤ 1000 chars) so the
 * adapters are held to the real contract.
 *
 * Control endpoints:  GET /__requests   POST /__fault {"runwayFailNext":"INTERNAL.BAD_OUTPUT"}   POST /__reset
 */
import http from "node:http";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const PORT = Number(process.env.PORT || 9100);
const PUBLIC = (process.env.MOCK_PUBLIC_URL || `http://localhost:${PORT}`).replace(/\/+$/, "");
const FILES = "/tmp/mock-files";
fs.mkdirSync(FILES, { recursive: true });

let requests = [];
let faults = {};
const tasks = new Map();
let webhookUrl = "";
let messageId = 1000;

const json = (res, status, body) => res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(body));

function ffmpeg(args) {
  const r = spawnSync("ffmpeg", ["-y", "-v", "error", ...args], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(r.stderr);
}

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks)));
  });
}

const RUNWAY_RULES = {
  "gen4.5": { ratios: ["1280:720", "720:1280"], durationOk: (d) => Number.isInteger(d) && d >= 2 && d <= 10 },
  "veo3.1": { ratios: ["1280:720", "720:1280", "1080:1920", "1920:1080"], durationOk: (d) => [4, 6, 8].includes(d) },
  "veo3.1_fast": { ratios: ["1280:720", "720:1280", "1080:1920", "1920:1080"], durationOk: (d) => [4, 6, 8].includes(d) },
};

function scriptFor(userPrompt) {
  const dur = Number(/Target duration: (\d+)/.exec(userPrompt)?.[1] || 30);
  const count = Math.max(3, Math.min(12, Math.round(dur / 6)));
  const each = Math.max(4, Math.min(8, Math.round(dur / count)));
  const topic = /Topic: (.*)/.exec(userPrompt)?.[1] || "the product";
  return {
    hook: `A fresh look at ${topic}`,
    scenes: Array.from({ length: count }, (_, i) => ({
      index: i,
      visualPrompt: `Mock scene ${i + 1}: bright modern marketplace stall with fresh produce, slow dolly-in, warm natural light`,
      voiceoverText: i === count - 1 ? "Download Eki today and shop your favourite foods." : `This is mock narration for scene ${i + 1} about ${topic}.`,
      subtitleText: i === count - 1 ? "Download Eki today" : `Scene ${i + 1}: ${topic}`,
      durationSec: each,
    })),
    caption: `Mock caption about ${topic}`,
    hashtags: ["#Eki", "#MockTest"],
  };
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://mock");
  const body = await readBody(req);
  const p = url.pathname;
  if (!p.startsWith("/__") && !p.startsWith("/files/")) {
    requests.push({ at: new Date().toISOString(), method: req.method, path: p, auth: req.headers.authorization ? "present" : req.headers["xi-api-key"] ? "xi-api-key" : "none", contentType: req.headers["content-type"] || null, bytes: body.length });
  }
  try {
    // ---------------- control
    if (p === "/__requests") return json(res, 200, requests);
    if (p === "/__reset") {
      requests = [];
      faults = {};
      return json(res, 200, { ok: true });
    }
    if (p === "/__fault") {
      faults = { ...faults, ...JSON.parse(body.toString() || "{}") };
      return json(res, 200, faults);
    }
    if (p.startsWith("/files/")) {
      const file = path.join(FILES, path.basename(p));
      if (!fs.existsSync(file)) return json(res, 404, {});
      res.writeHead(200, { "content-type": file.endsWith(".mp4") ? "video/mp4" : "audio/mpeg" });
      return fs.createReadStream(file).pipe(res);
    }

    // ---------------- OpenAI / Groq (OpenAI-compatible)
    if (/\/v1\/models$/.test(p) && req.method === "GET") return json(res, 200, { data: [{ id: "gpt-4o-mini" }, { id: "llama-3.3-70b-versatile" }] });
    if (/\/v1\/chat\/completions$/.test(p)) {
      if (!req.headers.authorization) return json(res, 401, { error: { message: "Missing key" } });
      const b = JSON.parse(body.toString());
      if (b.response_format?.type !== "json_object") return json(res, 400, { error: { message: "expected json_object" } });
      const user = b.messages.find((m) => m.role === "user")?.content || "";
      return json(res, 200, { choices: [{ message: { content: JSON.stringify(scriptFor(user)) } }] });
    }

    // ---------------- Runway (api.dev.runwayml.com, X-Runway-Version 2024-11-06)
    if (p === "/v1/organization") return json(res, 200, { creditBalance: 5000 });
    if (p === "/v1/text_to_video" && req.method === "POST") {
      if (req.headers["x-runway-version"] !== "2024-11-06") return json(res, 400, { error: "Missing or invalid X-Runway-Version" });
      const b = JSON.parse(body.toString());
      const rules = RUNWAY_RULES[b.model];
      if (!rules) return json(res, 400, { error: `Unsupported model ${b.model}` });
      if (!rules.ratios.includes(b.ratio)) return json(res, 400, { error: `Invalid ratio ${b.ratio} for ${b.model}` });
      if (!rules.durationOk(b.duration)) return json(res, 400, { error: `Invalid duration ${b.duration} for ${b.model}` });
      if (!b.promptText || b.promptText.length > 1000) return json(res, 400, { error: "promptText must be 1-1000 chars" });
      const id = crypto.randomUUID();
      const [w, h] = b.ratio.split(":").map(Number);
      const failureCode = faults.runwayFailNext || null;
      if (faults.runwayFailNext) delete faults.runwayFailNext;
      tasks.set(id, { polls: 0, w, h, duration: b.duration, failureCode });
      return json(res, 200, { id, estimatedCost: { credits: 12 * b.duration } });
    }
    const task = /^\/v1\/tasks\/([\w-]+)$/.exec(p);
    if (task) {
      const t = tasks.get(task[1]);
      if (!t) return json(res, 404, { error: "Task not found" });
      if (req.method === "DELETE") {
        t.cancelled = true;
        res.writeHead(204).end();
        return;
      }
      if (t.cancelled) return json(res, 200, { id: task[1], status: "CANCELLED", createdAt: new Date().toISOString() });
      t.polls += 1;
      if (t.polls < 2) return json(res, 200, { id: task[1], status: "RUNNING", progress: 0.5, createdAt: new Date().toISOString() });
      if (t.failureCode) return json(res, 200, { id: task[1], status: "FAILED", failure: "Mock internal failure", failureCode: t.failureCode, createdAt: new Date().toISOString() });
      const file = path.join(FILES, `${task[1]}.mp4`);
      if (!fs.existsSync(file)) ffmpeg(["-f", "lavfi", "-i", `testsrc2=size=${t.w}x${t.h}:rate=24`, "-t", String(t.duration), "-pix_fmt", "yuv420p", "-c:v", "libx264", file]);
      return json(res, 200, { id: task[1], status: "SUCCEEDED", output: [`${PUBLIC}/files/${task[1]}.mp4`], createdAt: new Date().toISOString() });
    }

    // ---------------- ElevenLabs
    const voice = /^\/v1\/voices\/([\w-]+)$/.exec(p);
    if (voice) return req.headers["xi-api-key"] ? json(res, 200, { voice_id: voice[1], name: "Mock Voice" }) : json(res, 401, { detail: { message: "invalid api key" } });
    if (p === "/v1/user/subscription") return json(res, 200, { character_count: 100, character_limit: 100000 });
    const tts = /^\/v1\/text-to-speech\/([\w-]+)$/.exec(p);
    if (tts) {
      if (!req.headers["xi-api-key"]) return json(res, 401, { detail: { message: "invalid api key" } });
      const b = JSON.parse(body.toString());
      if (!b.text || !b.model_id) return json(res, 422, { detail: { message: "text and model_id required" } });
      const seconds = Math.max(1.5, b.text.split(/\s+/).length / 2.5);
      const file = path.join(FILES, `tts-${crypto.randomUUID()}.mp3`);
      ffmpeg(["-f", "lavfi", "-i", "sine=frequency=440:sample_rate=44100", "-t", seconds.toFixed(2), "-c:a", "libmp3lame", file]);
      res.writeHead(200, { "content-type": "audio/mpeg", "request-id": `mock-${crypto.randomUUID()}` });
      return fs.createReadStream(file).pipe(res);
    }

    // ---------------- Telegram Bot API
    const tg = /^\/bot([^/]+)\/(\w+)$/.exec(p);
    if (tg) {
      const [, token, method] = tg;
      if (!/^\d{6,}:[\w-]{30,}$/.test(token)) return json(res, 401, { ok: false, error_code: 401, description: "Unauthorized" });
      if (method === "getMe") return json(res, 200, { ok: true, result: { id: 1, is_bot: true, username: "eki_mock_bot" } });
      if (method === "getChat") return json(res, 200, { ok: true, result: { id: -100123, title: "Eki mock team" } });
      if (method === "getWebhookInfo") return json(res, 200, { ok: true, result: { url: webhookUrl } });
      if (method === "setWebhook") {
        webhookUrl = JSON.parse(body.toString()).url;
        return json(res, 200, { ok: true, result: true });
      }
      if (method === "sendVideo") {
        const ct = req.headers["content-type"] || "";
        if (!ct.startsWith("multipart/form-data")) return json(res, 400, { ok: false, description: "sendVideo expects multipart" });
        requests[requests.length - 1].note = `video upload ${body.length} bytes; has reply_markup=${body.includes("vid:approve:")}`;
        return json(res, 200, { ok: true, result: { message_id: ++messageId } });
      }
      if (["sendMessage", "answerCallbackQuery", "editMessageReplyMarkup"].includes(method)) return json(res, 200, { ok: true, result: { message_id: ++messageId } });
      return json(res, 404, { ok: false, description: `mock: ${method} not implemented` });
    }

    // ---------------- Meta Graph (OAuth + Page/IG publish)
    if (/\/oauth\/access_token$/.test(p)) return json(res, 200, { access_token: `mock-meta-token-${crypto.randomUUID()}`, token_type: "bearer", expires_in: 5183944 });
    if (/\/me\/accounts$/.test(p)) {
      return json(res, 200, { data: [{ id: "900000000000001", name: "Eki Mock Page", access_token: `mock-page-token-${crypto.randomUUID()}`, instagram_business_account: { id: "170000000000001", username: "eki.mock" } }] });
    }
    const igMedia = /^\/v[\d.]+\/(\d+)\/media$/.exec(p);
    if (igMedia && req.method === "POST") {
      const form = new URLSearchParams(body.toString());
      if (form.get("media_type") !== "REELS" || !form.get("video_url")) return json(res, 400, { error: { message: "media_type=REELS and video_url required" } });
      const fetched = await fetch(form.get("video_url")).then((r) => r.ok).catch(() => false);
      if (!fetched) return json(res, 400, { error: { message: "Media download failed: video_url not reachable" } });
      return json(res, 200, { id: `container-${crypto.randomUUID()}` });
    }
    if (/^\/v[\d.]+\/\d+\/media_publish$/.test(p)) return json(res, 200, { id: "179000000000123" });
    if (/^\/v[\d.]+\/\d+\/videos$/.test(p)) return json(res, 200, { id: "100000000000777" });
    const node = /^\/v[\d.]+\/([\w-]+)$/.exec(p);
    if (node) {
      if (node[1].startsWith("container-")) return json(res, 200, { status_code: "FINISHED", status: "Finished" });
      if (node[1] === "179000000000123") return json(res, 200, { permalink: "https://www.instagram.com/reel/MOCK/" });
      return json(res, 200, { id: node[1], name: "Eki Mock Page", instagram_business_account: { username: "eki.mock" } });
    }

    return json(res, 404, { error: `mock: no route for ${req.method} ${p}` });
  } catch (err) {
    return json(res, 500, { error: String(err && err.message) });
  }
});

server.listen(PORT, "0.0.0.0", () => console.log(`[mock-providers] listening on :${PORT} (public ${PUBLIC})`));
