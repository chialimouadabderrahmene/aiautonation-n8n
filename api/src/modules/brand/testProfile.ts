/**
 * "Test profile against sample content" — a synchronous admin action, not a
 * queued job: generate one short sample for the given brief using whichever
 * profile is passed (draft or active), run it through the same critic the
 * real pipeline uses, and return both so the admin can judge the voice
 * before activating a draft. Mirrors worker/src/pipeline/script.ts's AI-call
 * shape (JSON mode, zod-validated), kept here because this is a quick API
 * round-trip, not a tracked worker job.
 */
import { z } from "zod";
import { prisma } from "../../lib/prisma";
import { getProviderValues } from "../integrations/vault";
import { timedFetch, describeHttpFailure, readErrorDetail, safeErrorMessage } from "../../lib/http";
import { getBrandContext } from "./promptBlock";

const sampleSchema = z.object({ caption: z.string().min(1), score: z.number().min(0).max(100), onBrand: z.boolean(), violations: z.array(z.string()).max(10) });

async function chooseProvider(): Promise<{ key: string; baseUrl: string; apiKey: string; model: string }> {
  for (const [key, baseUrl, fallbackModel] of [
    ["openai", "https://api.openai.com/v1", "gpt-4o-mini"],
    ["groq", "https://api.groq.com/openai/v1", "llama-3.3-70b-versatile"],
  ] as const) {
    const v = await getProviderValues(key);
    const integration = await prisma.integration.findUnique({ where: { provider: key } });
    if (integration?.status === "CONNECTED" && v?.apiKey) return { key, baseUrl, apiKey: v.apiKey, model: v.model || fallbackModel };
  }
  throw new Error("Connect OpenAI or Groq in Connected Apps first — testing a profile needs a real AI call");
}

export interface TestProfileResult {
  sample: string;
  score: number;
  onBrand: boolean;
  violations: string[];
  provider: string;
}

export async function testBrandProfile(brief: string, draft: { brandId?: string; audienceId?: string }): Promise<TestProfileResult> {
  const ai = await chooseProvider();
  const brand = await getBrandContext(draft.brandId, draft.audienceId);
  const system = [
    "Write ONE short marketing caption (2-3 sentences) for the brief below, in the given brand voice and audience vocabulary.",
    "Then score your own output 0-100 for how well it matches the voice/vocabulary, list any violations, and say whether it's on-brand.",
    'Return ONLY JSON: {"caption":"...","score":0-100,"onBrand":boolean,"violations":["..."]}',
  ].join(" ");
  const user = [brand.promptBlock, `Brief: ${brief}`].filter(Boolean).join("\n");

  try {
    const { res } = await timedFetch(
      `${ai.baseUrl}/chat/completions`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${ai.apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model: ai.model, response_format: { type: "json_object" }, temperature: 0.6, messages: [{ role: "system", content: system }, { role: "user", content: user }] }),
      },
      30_000,
    );
    if (!res.ok) throw describeHttpFailure(ai.key === "openai" ? "OpenAI" : "Groq", res.status, await readErrorDetail(res));
    const data = (await res.json()) as { choices: { message: { content: string } }[] };
    const raw = data.choices[0]?.message.content ?? "";
    const parsed = sampleSchema.safeParse(JSON.parse(raw.replace(/^```(?:json)?\s*|\s*```$/g, "")));
    if (!parsed.success) throw new Error("The AI provider did not return valid JSON for this test");
    return { sample: parsed.data.caption, score: parsed.data.score, onBrand: parsed.data.onBrand, violations: parsed.data.violations, provider: ai.key };
  } catch (err) {
    throw new Error(safeErrorMessage(err));
  }
}
