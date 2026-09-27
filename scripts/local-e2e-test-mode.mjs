#!/usr/bin/env node
/**
 * LOCAL END-TO-END TEST (test mode, mock providers) — NOT a production test.
 *
 * Requires the local stack started with docker/docker-compose.test.yml, i.e.
 * provider hostnames redirected to tools/mock-providers. Everything else is
 * real: the web proxy, API, Postgres, Redis/BullMQ, the worker, FFmpeg, S3
 * storage, n8n and its supervisor.
 *
 * Exercises: configure → test → CONNECTED → readiness READY → activate/disable
 * in n8n → video generation (real FFmpeg MP4 in S3) → automatic Telegram
 * multipart upload with APPROVE/REJECT buttons → Telegram callback approval →
 * Meta OAuth connect (server-side code exchange) → publishing → reject +
 * regenerate → automatic retry that resumes without re-billing completed
 * stages → cancellation (Runway task cancelled).
 *
 *   E2E_EMAIL=... E2E_PASSWORD=... node scripts/local-e2e-test-mode.mjs
 */
import { execSync } from "node:child_process";

const BASE = process.env.E2E_BASE_URL || "http://localhost:3200";
const API_CONTAINER = process.env.E2E_API_CONTAINER || "eki-automation-api-1";
const WORKER_CONTAINER = process.env.E2E_WORKER_CONTAINER || "eki-automation-worker-1";
const MOCK = process.env.E2E_MOCK_URL || "http://localhost:9100";
let token = "";
const results = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function call(method, path, body, headers = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
    body: body === undefined ? undefined : typeof body === "string" || body instanceof Uint8Array ? body : JSON.stringify(body),
    redirect: "manual",
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* not json */
  }
  return { status: res.status, json, text, headers: res.headers };
}

async function mock(path, body) {
  const res = await fetch(`${MOCK}${path}`, { method: body ? "POST" : "GET", headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  return res.json();
}

async function check(name, fn) {
  const t = Date.now();
  try {
    const detail = await fn();
    results.push({ name, ok: true, detail, ms: Date.now() - t });
    console.log(`PASS  ${name}${detail ? ` — ${detail}` : ""}`);
  } catch (err) {
    results.push({ name, ok: false, detail: err.message, ms: Date.now() - t });
    console.log(`FAIL  ${name} — ${err.message}`);
  }
}
const assert = (c, m) => {
  if (!c) throw new Error(m);
};

async function waitJob(id, until, timeoutMs = 8 * 60_000) {
  const deadline = Date.now() + timeoutMs;
  let last;
  for (;;) {
    last = (await call("GET", `/api/video/jobs/${id}`)).json;
    if (until(last)) return last;
    if (Date.now() > deadline) throw new Error(`timeout; job state ${last?.state} ${last?.error ?? ""}`);
    await sleep(3000);
  }
}

const PROJECT = {
  name: "E2E test-mode video",
  contentType: "Instagram Reel",
  topic: "Eki African food marketplace",
  prompt: "Create a 30-second vertical Eki promotional video showing a modern African food marketplace experience, professional commercial style, realistic visuals, natural voiceover, subtitles and a clear call to action.",
  audience: "African diaspora in Europe",
  language: "en",
  tone: "Professional",
  durationSec: 30,
  aspectRatio: "9:16",
  visualStyle: "Commercial",
  subtitles: true,
  brand: "Eki",
  cta: "Download Eki today",
};

async function main() {
  const login = await call("POST", "/api/auth/login", { email: process.env.E2E_EMAIL, password: process.env.E2E_PASSWORD });
  token = login.json.token;
  const dash = (await call("GET", "/api/dashboard")).json;
  assert(dash.testModeOverrides, "Refusing to run: the stack is NOT in test mode (docker-compose.test.yml).");
  await mock("/__reset", {});

  await check("Configure + test OpenAI, Runway, ElevenLabs, Telegram (mock endpoints)", async () => {
    const configs = {
      openai: { secrets: { apiKey: "sk-mock00000000000000000000000000" }, config: { model: "gpt-4o-mini" } },
      runway: { secrets: { apiKey: "key_mock_0000000000000000" }, config: { model: "gen4.5" } },
      elevenlabs: { secrets: { apiKey: "sk_mock_elevenlabs_000000" }, config: { voiceId: "mockvoice0001" } },
      telegram: { secrets: { botToken: "123456789:AAmockmockmockmockmockmockmockmockmo" }, config: { approvalChatId: "-100123456789" } },
    };
    const out = [];
    for (const [p, body] of Object.entries(configs)) {
      const s = await call("PUT", `/api/integrations/${p}`, body);
      assert(s.status === 200, `${p} save ${s.status} ${s.json?.message}`);
      const t = await call("POST", `/api/integrations/${p}/test`);
      assert(t.json?.ok, `${p} test: ${t.json?.message}`);
      out.push(`${p}=CONNECTED`);
    }
    const listing = (await call("GET", "/api/integrations")).text;
    assert(!listing.includes("AAmockmockmockmock") && !listing.includes("sk-mock0000000"), "secret leaked in listing");
    return `${out.join(", ")}; secrets absent from API responses`;
  });

  await check("Telegram webhook registered automatically", async () => {
    for (let i = 0; i < 10; i++) {
      const v = (await call("GET", "/api/video/readiness")).json;
      if (v.approval.readiness === "READY") return "approval readiness READY";
      await sleep(2000);
    }
    throw new Error("approval readiness never became READY");
  });

  await check("Video pipeline readiness READY", async () => {
    const v = (await call("GET", "/api/video/readiness")).json;
    assert(v.readiness === "READY", v.detail.filter((d) => !d.ok).map((d) => d.note).join("; "));
    return v.detail.map((d) => `${d.ok ? "✓" : "✕"} ${d.label}`).join(", ");
  });

  await check("Readiness → activate-ready enables only READY workflows in n8n; disable works", async () => {
    await sleep(4000); // debounced n8n credential sync
    await call("POST", "/api/workflows/sync");
    const r = (await call("POST", "/api/workflows/activate-ready")).json;
    assert(r.activated.includes("00-global-error-handler"), `activated=${r.activated}`);
    assert(r.skipped.length === 22 - r.activated.length - r.alreadyActive.length, "skip count mismatch");
    const wf = (await call("GET", "/api/workflows")).json.find((w) => w.key === "00-global-error-handler");
    assert(wf.enabled && wf.n8nActive, "00 not active in n8n");
    const d = await call("POST", "/api/workflows/00-global-error-handler/disable");
    assert(d.status === 200, "disable failed");
    const wf2 = (await call("GET", "/api/workflows")).json.find((w) => w.key === "00-global-error-handler");
    assert(!wf2.n8nActive, "still active after disable");
    return `activated ${r.summary.activated}, skipped ${r.summary.skipped} (each with reasons); disabled again`;
  });

  let musicId = null;
  await check("Music upload (raw audio → S3)", async () => {
    execSync(`docker exec ${WORKER_CONTAINER} ffmpeg -v error -y -f lavfi -i sine=frequency=220:sample_rate=44100 -t 20 -c:a libmp3lame /tmp/music.mp3 && docker cp ${WORKER_CONTAINER}:/tmp/music.mp3 /tmp/e2e-music.mp3`);
    const bytes = (await import("node:fs")).readFileSync("/tmp/e2e-music.mp3");
    const r = await call("POST", "/api/media/music?name=E2E%20bed", bytes, { "content-type": "audio/mpeg" });
    assert(r.status === 201, `upload ${r.status} ${r.text.slice(0, 100)}`);
    musicId = r.json.id;
    return `${r.json.sizeBytes} bytes stored`;
  });

  let job1;
  await check("Generate video → READY (script, per-scene voice, Runway clips, FFmpeg, QA, S3)", async () => {
    const r = await call("POST", "/api/video/projects", { ...PROJECT, musicFileId: musicId });
    assert(r.status === 201, `create ${r.status} ${r.json?.message}`);
    const seen = new Set();
    job1 = await waitJob(r.json.job.id, (j) => {
      seen.add(j.state);
      return ["READY", "FAILED"].includes(j.state);
    });
    assert(job1.state === "READY", `ended ${job1.state}: ${job1.error}`);
    const f = job1.finalVideo;
    assert(f.width === 1080 && f.height === 1920, `size ${f.width}x${f.height}`);
    assert(f.metadata.qa.decodes && f.metadata.qa.audio && f.metadata.music && f.metadata.subtitles, "qa/music/subtitles metadata");
    const head = await fetch(f.playUrl.startsWith("http") ? f.playUrl : `${BASE}${f.playUrl}`).catch(() => null);
    return `${job1.scenes.length} scenes, ${f.durationSec.toFixed(1)}s ${f.width}x${f.height}, ${(f.sizeBytes / 1e6).toFixed(1)} MB; states seen: ${[...seen].join("→")}; signed URL fetch from host: ${head ? head.status : "not reachable from host (bucket is private to the compose network)"}`;
  });

  await check("READY video sent to Telegram automatically (multipart, APPROVE/REJECT buttons)", async () => {
    const reqs = await mock("/__requests");
    const send = reqs.find((r) => r.path.endsWith("/sendVideo"));
    assert(send && /has reply_markup=true/.test(send.note ?? ""), "no sendVideo with buttons recorded");
    const appr = (await call("GET", `/api/approvals/video/${job1.id}`)).json;
    assert(appr?.status === "PENDING", `approval ${appr?.status}`);
    return `${send.note}; approval PENDING`;
  });

  await check("Scene voice/visual calls match scene count (no duplicate billing)", async () => {
    const reqs = await mock("/__requests");
    const tts = reqs.filter((r) => r.path.startsWith("/v1/text-to-speech/")).length;
    const t2v = reqs.filter((r) => r.path === "/v1/text_to_video").length;
    assert(tts === job1.scenes.length && t2v === job1.scenes.length, `tts=${tts} t2v=${t2v} scenes=${job1.scenes.length}`);
    return `${tts} TTS + ${t2v} text_to_video for ${job1.scenes.length} scenes`;
  });

  await check("Forged Telegram callback rejected; real callback from the team chat approves", async () => {
    const forged = await call("POST", "/api/telegram/webhook", { callback_query: { id: "1", data: `vid:approve:${job1.id}` } }, { "x-telegram-bot-api-secret-token": "wrong" });
    assert(forged.status === 403, `forged → ${forged.status}`);
    const secret = execSync(
      `docker exec ${API_CONTAINER} node -e "const {getDecryptedCredentials}=require('./dist/modules/integrations/vault');getDecryptedCredentials('webhooks').then(c=>process.stdout.write(c.secrets.telegramWebhookSecret))"`,
      { encoding: "utf8" },
    );
    const wrongChat = await call("POST", "/api/telegram/webhook", { callback_query: { id: "2", data: `vid:approve:${job1.id}`, from: { username: "intruder" }, message: { chat: { id: -999 }, message_id: 5 } } }, { "x-telegram-bot-api-secret-token": secret });
    assert(wrongChat.status === 200, "webhook should ack");
    assert((await call("GET", `/api/approvals/video/${job1.id}`)).json.status === "PENDING", "approved from a foreign chat!");
    await call("POST", "/api/telegram/webhook", { callback_query: { id: "3", data: `vid:approve:${job1.id}`, from: { username: "eki_editor" }, message: { chat: { id: -100123456789 }, message_id: 5 } } }, { "x-telegram-bot-api-secret-token": secret });
    await sleep(1500);
    const appr = (await call("GET", `/api/approvals/video/${job1.id}`)).json;
    assert(appr.status === "APPROVED" && appr.decidedBy === "@eki_editor", `approval ${appr.status} by ${appr.decidedBy}`);
    return "forged → 403; foreign chat ignored; team chat → APPROVED by @eki_editor";
  });

  await check("Meta OAuth: server-side code exchange, tokens never returned", async () => {
    const s = await call("PUT", "/api/integrations/meta", { secrets: { appSecret: "mock-meta-app-secret" }, config: { appId: "123456789012" } });
    assert(s.status === 200, `save ${s.status} ${s.json?.message}`);
    const start = await call("POST", "/api/integrations/meta/oauth/start");
    assert(start.status === 200, `start ${start.status} ${start.json?.message}`);
    const u = new URL(start.json.authorizeUrl);
    assert(u.hostname === "www.facebook.com" && u.searchParams.get("redirect_uri")?.endsWith("/api/oauth/callback/meta"), "authorize URL");
    const cb = await call("GET", `/api/oauth/callback/meta?code=mockcode&state=${u.searchParams.get("state")}`);
    assert(cb.status === 302 && /result=ok/.test(cb.headers.get("location")), `callback ${cb.status} ${cb.headers.get("location")}`);
    const replay = await call("GET", `/api/oauth/callback/meta?code=mockcode&state=${u.searchParams.get("state")}`);
    assert(/result=error/.test(replay.headers.get("location")), "state replay accepted");
    const meta = (await call("GET", "/api/integrations")).json.find((i) => i.provider === "meta");
    assert(meta.status === "CONNECTED" && meta.connectedAccount, `meta ${meta.status}`);
    assert(!JSON.stringify(meta).includes("mock-page-token") && !JSON.stringify(meta).includes("mock-meta-token"), "token leaked");
    return `CONNECTED as "${meta.connectedAccount}"; state is single-use; tokens not in responses`;
  });

  await check("Approve → publish to Instagram + Facebook", async () => {
    const r = await call("POST", "/api/video/projects", { ...PROJECT, name: "E2E publish", durationSec: 15, publishTargets: ["instagram", "facebook"] });
    assert(r.status === 201, `create ${r.status} ${r.json?.message}`);
    const j = await waitJob(r.json.job.id, (x) => ["READY", "FAILED"].includes(x.state));
    assert(j.state === "READY", `${j.state} ${j.error}`);
    await call("POST", `/api/approvals/video/${j.id}/decision`, { decision: "APPROVED" });
    const done = await waitJob(j.id, (x) => x.publications.length === 2 && x.publications.every((p) => ["PUBLISHED", "FAILED"].includes(p.status)), 120_000);
    assert(done.publications.every((p) => p.status === "PUBLISHED"), done.publications.map((p) => `${p.target}:${p.status}:${p.error}`).join(" "));
    return done.publications.map((p) => `${p.target} → ${p.externalUrl}`).join(", ");
  });

  await check("Reject → regenerate starts a fresh job", async () => {
    const r = await call("POST", "/api/video/projects", { ...PROJECT, name: "E2E reject", durationSec: 15 });
    const j = await waitJob(r.json.job.id, (x) => ["READY", "FAILED"].includes(x.state));
    await call("POST", `/api/approvals/video/${j.id}/decision`, { decision: "REJECTED", reason: "Too dark" });
    const regen = await call("POST", `/api/video/projects/${j.projectId}/regenerate`, { note: "Brighter scenes" });
    assert(regen.status === 201 && regen.json.job.id !== j.id, `regenerate ${regen.status}`);
    const j2 = await waitJob(regen.json.job.id, (x) => ["READY", "FAILED"].includes(x.state));
    assert(j2.state === "READY", `regenerated job ${j2.state}`);
    assert(/Revision request: Brighter scenes/.test(j2.project.prompt), "revision note not added to brief");
    return `rejected (reason stored) → new job ${regen.json.job.id} READY`;
  });

  await check("Provider failure → automatic retry resumes without repeating finished stages", async () => {
    await mock("/__reset", {});
    await mock("/__fault", { runwayFailNext: "INTERNAL.BAD_OUTPUT" });
    const r = await call("POST", "/api/video/projects", { ...PROJECT, name: "E2E retry", durationSec: 15 });
    const j = await waitJob(r.json.job.id, (x) => ["READY", "FAILED"].includes(x.state), 10 * 60_000);
    assert(j.state === "READY", `${j.state} ${j.error}`);
    const reqs = await mock("/__requests");
    const chats = reqs.filter((x) => x.path.endsWith("/chat/completions")).length;
    const tts = reqs.filter((x) => x.path.startsWith("/v1/text-to-speech/")).length;
    const t2v = reqs.filter((x) => x.path === "/v1/text_to_video").length;
    assert(chats === 1 && tts === j.scenes.length && t2v === j.scenes.length + 1, `chat=${chats} tts=${tts} t2v=${t2v} scenes=${j.scenes.length}`);
    const ex = (await call("GET", "/api/executions?source=VIDEO_WORKER&limit=50")).json.items.filter((e) => e.relatedEntityId === j.id && e.trigger !== "telegram:send-approval");
    assert(ex.some((e) => e.status === "FAILED") && ex.some((e) => e.status === "SUCCESS"), "expected one FAILED + one SUCCESS execution");
    return `1 script call, ${tts} TTS, ${t2v} Runway tasks (1 retried) for ${j.scenes.length} scenes; executions: ${ex.map((e) => `${e.status}/retry${e.retryCount}`).join(", ")}`;
  });

  await check("Cancel during generation cancels the Runway task", async () => {
    await mock("/__reset", {});
    const r = await call("POST", "/api/video/projects", { ...PROJECT, name: "E2E cancel", durationSec: 30 });
    await waitJob(r.json.job.id, (x) => x.state === "VISUAL_GENERATING", 120_000);
    const c = await call("POST", `/api/video/jobs/${r.json.job.id}/cancel`);
    assert(c.status === 200, `cancel ${c.status}`);
    for (let i = 0; i < 20; i++) {
      if ((await mock("/__requests")).some((x) => x.method === "DELETE" && x.path.startsWith("/v1/tasks/"))) break;
      await sleep(2000);
    }
    const j = (await call("GET", `/api/video/jobs/${r.json.job.id}`)).json;
    assert(j.state === "CANCELLED", j.state);
    assert((await mock("/__requests")).some((x) => x.method === "DELETE"), "Runway task not cancelled");
    return "job CANCELLED; DELETE /v1/tasks/{id} sent to Runway";
  });

  await check("Executions + reports reflect the runs", async () => {
    const rep = (await call("GET", "/api/reports?period=day")).json;
    assert(rep.videosGenerated >= 4 && rep.publicationsPublished >= 2, JSON.stringify(rep).slice(0, 200));
    return `videos ${rep.videosGenerated}, failed executions ${rep.failedExecutions}, published ${rep.publicationsPublished}, success rate ${rep.successRate}%`;
  });

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  console.log(JSON.stringify({ at: new Date().toISOString(), mode: "LOCAL TEST MODE (mock providers)", results }, null, 2));
  process.exitCode = failed.length ? 1 : 0;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
