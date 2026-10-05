import { getDecryptedCredentials } from "./credentials";
import { ProviderError } from "./http";

/** Picks the first CONNECTED OpenAI-compatible provider (OpenAI, then Groq). Shared by script.ts and critic.ts. */
export async function chooseProvider() {
  for (const [key, baseUrl, fallbackModel] of [
    ["openai", "https://api.openai.com/v1", "gpt-4o-mini"],
    ["groq", "https://api.groq.com/openai/v1", "llama-3.3-70b-versatile"],
  ] as const) {
    const c = await getDecryptedCredentials(key);
    if (c?.status === "CONNECTED" && c.secrets.apiKey) return { key, baseUrl, apiKey: c.secrets.apiKey, model: c.config.model || fallbackModel };
  }
  throw new ProviderError("Neither OpenAI nor Groq is connected — cannot write the script", null, false);
}
