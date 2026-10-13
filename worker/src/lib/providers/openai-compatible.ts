import { timedFetch, describeHttpFailure, readErrorDetail, withRetry, ProviderError } from "../http";
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
      const data = await withRetry(async () => {
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
        return (await res.json()) as { choices: { message: { content: string } }[] };
      });
      const raw = data.choices[0]?.message.content;
      if (!raw) throw new ProviderError(`${label} returned no content`, null, true);
      return { raw, provider: key, model };
    },
  };
}
