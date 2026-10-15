import { timedFetch, describeHttpFailure, readErrorDetail, withRetry, ProviderError } from "../http";
import { recordUsage } from "../usage-ledger";
import { AIProvider, ChatJSONRequest, ChatJSONResult } from "./types";

const ANTHROPIC_API = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";

/**
 * Anthropic's Messages API has no OpenAI-style `response_format: json_object`
 * mode, so JSON-only output is enforced by instruction (added to the system
 * prompt) the same way every other model-agnostic JSON-via-prompting setup
 * works — callers already strip markdown fences and validate with zod
 * defensively, so this needs no special-casing downstream.
 */
export function createAnthropic(apiKey: string, model: string): AIProvider {
  return {
    key: "anthropic",
    model,
    async chatJSON(req: ChatJSONRequest): Promise<ChatJSONResult> {
      const ctx = req.usageContext ?? {};
      const data = await withRetry(async (attempt) => {
        const startedAt = Date.now();
        // Every attempt is recorded, including retries, because each one can be billed.
        try {
        const { res } = await timedFetch(
          ANTHROPIC_API,
          {
            method: "POST",
            headers: { "x-api-key": apiKey, "anthropic-version": ANTHROPIC_VERSION, "Content-Type": "application/json" },
            body: JSON.stringify({
              model,
              max_tokens: 4096,
              temperature: req.temperature ?? 0.7,
              system: `${req.system} Respond with ONLY the JSON object — no markdown fences, no prose before or after it.`,
              messages: [{ role: "user", content: req.user }],
            }),
          },
          req.timeoutMs ?? 90_000,
        );
        if (!res.ok) throw describeHttpFailure("Anthropic", res.status, await readErrorDetail(res));
        const body = (await res.json()) as { id?: string; content: { type: string; text?: string }[]; usage?: { input_tokens?: number; output_tokens?: number } };
        await recordUsage({
          provider: "anthropic", model, operation: "chat", workflowKey: ctx.workflowKey, executionRef: ctx.executionRef, attempt: attempt + 1,
          status: "SUCCEEDED", inputTokens: body.usage?.input_tokens ?? null, outputTokens: body.usage?.output_tokens ?? null,
          requestId: body.id ?? null, latencyMs: Date.now() - startedAt,
        });
        return body;
        } catch (err) {
          await recordUsage({
            provider: "anthropic", model, operation: "chat", workflowKey: ctx.workflowKey, executionRef: ctx.executionRef, attempt: attempt + 1,
            status: "FAILED", errorCode: err instanceof ProviderError && err.status ? `http_${err.status}` : "request_failed",
            latencyMs: Date.now() - startedAt,
          });
          throw err;
        }
      });
      const raw = data.content.find((c) => c.type === "text")?.text;
      if (!raw) throw new ProviderError("Anthropic returned no text content", null, true);
      return { raw, provider: "anthropic", model };
    },
  };
}
