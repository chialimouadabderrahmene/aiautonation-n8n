import { timedFetch, describeHttpFailure, readErrorDetail, withRetry, ProviderError } from "../http";
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
      const data = await withRetry(async () => {
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
        return (await res.json()) as { content: { type: string; text?: string }[] };
      });
      const raw = data.content.find((c) => c.type === "text")?.text;
      if (!raw) throw new ProviderError("Anthropic returned no text content", null, true);
      return { raw, provider: "anthropic", model };
    },
  };
}
