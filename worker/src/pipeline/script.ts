import { z } from "zod";
import { getDecryptedCredentials } from "../lib/credentials";

const sceneSchema = z.object({
  index: z.number().int().min(0),
  visualPrompt: z.string().min(1),
  voiceoverText: z.string().min(1),
  subtitleText: z.string().min(1),
  durationSec: z.number().min(2).max(15),
});

export const scriptSchema = z.object({
  hook: z.string().min(1),
  scenes: z.array(sceneSchema).min(1).max(12),
  caption: z.string().min(1),
  hashtags: z.array(z.string()).max(15),
});

export type GeneratedScript = z.infer<typeof scriptSchema>;

export interface ScriptRequest {
  contentType: string;
  topic: string;
  prompt: string;
  audience?: string | null;
  language: string;
  tone: string;
  durationSec: number;
  aspectRatio: string;
  visualStyle: string;
  brand: string;
  cta?: string | null;
}

/**
 * Calls whichever of OpenAI/Groq is configured (both speak the same
 * OpenAI-compatible chat-completions API), asking for strict JSON, then
 * validates it with zod before the pipeline ever touches it — an invalid or
 * missing-field response fails the job rather than producing a broken video.
 */
export async function generateScript(request: ScriptRequest): Promise<GeneratedScript> {
  const openai = await getDecryptedCredentials("openai");
  const groq = await getDecryptedCredentials("groq");
  const chosen = openai?.secrets.apiKey
    ? { baseUrl: "https://api.openai.com/v1", apiKey: openai.secrets.apiKey, model: openai.config.model || "gpt-4o-mini" }
    : groq?.secrets.apiKey
      ? { baseUrl: "https://api.groq.com/openai/v1", apiKey: groq.secrets.apiKey, model: groq.config.model || "llama-3.3-70b-versatile" }
      : null;
  if (!chosen) throw new Error("Neither OpenAI nor Groq is configured — cannot generate a script.");

  const sceneCount = Math.max(3, Math.min(8, Math.round(request.durationSec / 5)));
  const systemPrompt = [
    "You write short-form vertical video scripts for a real product marketing team.",
    "Return ONLY a JSON object — no markdown, no commentary — matching exactly this shape:",
    '{"hook":"...","scenes":[{"index":0,"visualPrompt":"...","voiceoverText":"...","subtitleText":"...","durationSec":5}],"caption":"...","hashtags":["..."]}',
    `Produce exactly ${sceneCount} scenes whose durationSec values sum to approximately ${request.durationSec}.`,
    "Never invent statistics, prices, dates or claims not present in the brief.",
    "visualPrompt is a prompt for an AI video generator (describe the shot, not narration). voiceoverText is what a narrator says. subtitleText is the on-screen caption for that scene (can equal voiceoverText, shortened).",
  ].join(" ");

  const userPrompt = [
    `Brand: ${request.brand}`,
    `Platform/content type: ${request.contentType}`,
    `Topic: ${request.topic}`,
    `Brief: ${request.prompt}`,
    request.audience ? `Audience: ${request.audience}` : "",
    `Language: ${request.language}`,
    `Tone: ${request.tone}`,
    `Visual style: ${request.visualStyle}`,
    `Target duration: ${request.durationSec} seconds`,
    `Aspect ratio: ${request.aspectRatio}`,
    request.cta ? `Call to action: ${request.cta}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  const res = await fetch(`${chosen.baseUrl}/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${chosen.apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: chosen.model,
      response_format: { type: "json_object" },
      temperature: 0.7,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`AI provider responded ${res.status}: ${body.slice(0, 300)}`);
  }

  const data = (await res.json()) as { choices: { message: { content: string } }[] };
  const raw = data.choices[0]?.message.content;
  if (!raw) throw new Error("AI provider returned no content");

  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new Error("AI provider did not return valid JSON");
  }

  const parsed = scriptSchema.safeParse(json);
  if (!parsed.success) {
    throw new Error(`AI script failed validation: ${parsed.error.issues.map((i) => i.message).join("; ")}`);
  }
  return parsed.data;
}
