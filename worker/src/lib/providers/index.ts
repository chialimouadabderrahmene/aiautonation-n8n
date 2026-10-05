import { prisma } from "../prisma";
import { getDecryptedCredentials } from "../credentials";
import { ProviderError } from "../http";
import { AIProvider } from "./types";
import { createOpenAICompatible } from "./openai-compatible";
import { createAnthropic } from "./anthropic";

export type { AIProvider, ChatJSONRequest, ChatJSONResult } from "./types";

interface Candidate {
  key: string;
  label: string;
  fallbackModel: string;
  build: (apiKey: string, model: string) => AIProvider;
}

const CANDIDATES: Candidate[] = [
  { key: "openai", label: "OpenAI", fallbackModel: "gpt-4o-mini", build: (k, m) => createOpenAICompatible("openai", "OpenAI", "https://api.openai.com/v1", k, m) },
  { key: "groq", label: "Groq", fallbackModel: "llama-3.3-70b-versatile", build: (k, m) => createOpenAICompatible("groq", "Groq", "https://api.groq.com/openai/v1", k, m) },
  { key: "anthropic", label: "Anthropic", fallbackModel: "claude-sonnet-4-5", build: (k, m) => createAnthropic(k, m) },
];

async function tryBuild(c: Candidate): Promise<AIProvider | null> {
  const creds = await getDecryptedCredentials(c.key);
  if (creds?.status !== "CONNECTED" || !creds.secrets.apiKey) return null;
  return c.build(creds.secrets.apiKey, creds.config.model || c.fallbackModel);
}

/**
 * Picks an AI provider for generation: the admin's explicit preference
 * (Settings -> "AI provider", frontend-configurable) if that one is
 * actually CONNECTED, otherwise the first CONNECTED candidate in
 * openai -> groq -> anthropic order. One common AIProvider interface comes
 * back either way — script.ts/slides.ts/critic.ts never branch on which.
 */
export async function chooseProvider(): Promise<AIProvider> {
  const preferred = (await prisma.setting.findUnique({ where: { key: "aiProvider" } }))?.value as string | undefined;
  if (preferred) {
    const match = CANDIDATES.find((c) => c.key === preferred);
    if (match) {
      const provider = await tryBuild(match);
      if (provider) return provider;
    }
  }
  for (const c of CANDIDATES) {
    const provider = await tryBuild(c);
    if (provider) return provider;
  }
  throw new ProviderError("No AI provider is connected (OpenAI, Groq or Anthropic) — connect one in Connected Apps", null, false);
}
