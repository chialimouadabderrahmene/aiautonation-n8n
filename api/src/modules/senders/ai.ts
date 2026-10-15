import { prisma } from "../../lib/prisma";
import { getProviderValues } from "../integrations/vault";
import { timedFetch, describeHttpFailure, readErrorDetail, withRetry, ProviderError } from "../../lib/http";
import { recordUsage } from "../../lib/usage-ledger";

export type AICompleteResult =
  | { ok: true; raw: string; json: unknown; provider: string; model: string }
  | { ok: false; reason: "not_configured" | "provider_error" | "invalid_json"; message: string };

/**
 * Chooses whichever of OpenAI/Groq is CONNECTED (OpenAI preferred), mirroring
 * worker/src/pipeline/script.ts's chooseProvider — this is the api-side equivalent,
 * reused by every native AI-driven workflow step (content generation, multiplication,
 * social-proof copy, performance insights) instead of each growing its own provider logic.
 */
async function chooseProvider(): Promise<{ key: string; baseUrl: string; apiKey: string; model: string } | null> {
  for (const [key, baseUrl, fallbackModel] of [
    ["openai", "https://api.openai.com/v1", "gpt-4o-mini"],
    ["groq", "https://api.groq.com/openai/v1", "llama-3.3-70b-versatile"],
    ["codecraft", "https://codecraftapi.com/v1", "gpt-4o-mini"],
  ] as const) {
    const integration = await prisma.integration.findUnique({ where: { provider: key } });
    if (integration?.status !== "CONNECTED") continue;
    const v = await getProviderValues(key);
    if (v?.apiKey) return { key, baseUrl, apiKey: v.apiKey, model: v.model || fallbackModel };
  }
  return null;
}

/**
 * A single AI chat-completion call shared by every native workflow that used to call an n8n
 * "AI" HTTP-request node. Deliberately generic (system/user prompt text lives in the workflow
 * DEFINITION, not in code) rather than one bespoke action per workflow — this is not the
 * forbidden "generic HTTP action" (it can only ever reach the two allow-listed AI providers,
 * never an arbitrary URL), it is the one AI call every content-generation workflow needs.
 */
export async function aiComplete(input: { system: string; user: string; jsonMode?: boolean; usageContext?: { workflowKey?: string; executionRef?: string } }): Promise<AICompleteResult> {
  const ai = await chooseProvider();
  if (!ai) return { ok: false, reason: "not_configured", message: "No AI provider is connected (OpenAI, Groq or CodeCraft API) — configure one in Integrations." };
  try {
    const ctx = input.usageContext ?? {};
    const data = await withRetry(async (attempt) => {
      const startedAt = Date.now();
      // Every attempt is recorded, including retries, because each one can be billed.
      try {
      const { res } = await timedFetch(
        `${ai.baseUrl}/chat/completions`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${ai.apiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            model: ai.model,
            temperature: 0.7,
            ...(input.jsonMode !== false ? { response_format: { type: "json_object" } } : {}),
            messages: [
              { role: "system", content: input.system },
              { role: "user", content: input.user },
            ],
          }),
        },
        60_000,
      );
      if (!res.ok) throw describeHttpFailure(ai.key === "openai" ? "OpenAI" : ai.key === "groq" ? "Groq" : "CodeCraft API", res.status, await readErrorDetail(res));
      const body = (await res.json()) as { id?: string; choices: { message: { content: string } }[]; usage?: { prompt_tokens?: number; completion_tokens?: number } };
      await recordUsage({
        provider: ai.key, model: ai.model, operation: "chat", workflowKey: ctx.workflowKey, executionRef: ctx.executionRef, attempt: attempt + 1,
        status: "SUCCEEDED", inputTokens: body.usage?.prompt_tokens ?? null, outputTokens: body.usage?.completion_tokens ?? null,
        requestId: body.id ?? null, latencyMs: Date.now() - startedAt,
      });
      return body;
      } catch (err) {
        await recordUsage({
          provider: ai.key, model: ai.model, operation: "chat", workflowKey: ctx.workflowKey, executionRef: ctx.executionRef, attempt: attempt + 1,
          status: "FAILED", errorCode: err instanceof ProviderError && err.status ? `http_${err.status}` : "request_failed",
          latencyMs: Date.now() - startedAt,
        });
        throw err;
      }
    });
    const raw = data.choices[0]?.message.content ?? "";
    if (!raw) return { ok: false, reason: "provider_error", message: "AI provider returned no content." };
    if (input.jsonMode === false) return { ok: true, raw, json: null, provider: ai.key, model: ai.model };
    try {
      const json = JSON.parse(raw.replace(/^```(?:json)?\s*|\s*```$/g, ""));
      return { ok: true, raw, json, provider: ai.key, model: ai.model };
    } catch {
      return { ok: false, reason: "invalid_json", message: "AI provider did not return valid JSON." };
    }
  } catch (err) {
    return { ok: false, reason: "provider_error", message: err instanceof Error ? err.message : String(err) };
  }
}
