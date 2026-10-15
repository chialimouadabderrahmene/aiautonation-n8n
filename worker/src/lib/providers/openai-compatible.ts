import { timedFetch, describeHttpFailure, readErrorDetail, withRetry, ProviderError } from "../http";
import { recordUsage } from "../usage-ledger";
import { AIProvider, ChatJSONRequest, ChatJSONResult } from "./types";

/**
 * One adapter for every OpenAI-compatible chat-completions API (OpenAI,
 * Groq — same request/response shape, same JSON mode). A third compatible
 * provider is a one-line addition in index.ts, not a new file.
 */
export function createOpenAICompatible(key: string, label: string, baseUrl: string, apiKey: string, model: string): AIProvider {
  return {
    key,
    model,
    async chatJSON(req: ChatJSONRequest): Promise<ChatJSONResult> {
      const ctx = req.usageContext ?? {};
      const data = await withRetry(async (attempt) => {
        const startedAt = Date.now();
        // Every attempt is recorded, including retries, because each one can be billed.
        try {
        const { res } = await timedFetch(
          `${baseUrl}/chat/completions`,
          {
            method: "POST",
            headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
            body: JSON.stringify({
              model,
              response_format: { type: "json_object" },
              temperature: req.temperature ?? 0.7,
              messages: [
                { role: "system", content: req.system },
                { role: "user", content: req.user },
              ],
            }),
          },
          req.timeoutMs ?? 90_000,
        );
        if (!res.ok) throw describeHttpFailure(label, res.status, await readErrorDetail(res));
        const body = (await res.json()) as { id?: string; choices: { message: { content: string } }[]; usage?: { prompt_tokens?: number; completion_tokens?: number } };
        await recordUsage({
          provider: key, model, operation: "chat", workflowKey: ctx.workflowKey, executionRef: ctx.executionRef, attempt: attempt + 1,
          status: "SUCCEEDED", inputTokens: body.usage?.prompt_tokens ?? null, outputTokens: body.usage?.completion_tokens ?? null,
          requestId: body.id ?? null, latencyMs: Date.now() - startedAt,
        });
        return body;
        } catch (err) {
          await recordUsage({
            provider: key, model, operation: "chat", workflowKey: ctx.workflowKey, executionRef: ctx.executionRef, attempt: attempt + 1,
            status: "FAILED", errorCode: err instanceof ProviderError && err.status ? `http_${err.status}` : "request_failed",
            latencyMs: Date.now() - startedAt,
          });
          throw err;
        }
      });
      const raw = data.choices[0]?.message.content;
      if (!raw) throw new ProviderError(`${label} returned no content`, null, true);
      return { raw, provider: key, model };
    },
  };
}
