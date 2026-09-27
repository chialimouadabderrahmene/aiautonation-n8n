import { requireConnected } from "../lib/credentials";
import { timedFetch, readErrorDetail, withRetry, ProviderError, scrubSecrets } from "../lib/http";

/**
 * ElevenLabs text-to-speech (POST /v1/text-to-speech/{voice_id}, verified
 * against the official @elevenlabs/elevenlabs-js SDK). One call per scene so
 * each scene's narration length is known exactly — the assembler uses it to
 * time subtitles and to hold the scene's picture while the voice finishes.
 */

export interface VoiceProvider {
  readonly name: string;
  synthesize(text: string, voiceId: string | undefined, languageCode?: string): Promise<{ audio: Buffer; requestId: string | null; voiceId: string; model: string }>;
}

function elevenError(status: number, detail: string | undefined): ProviderError {
  const d = detail ? `: ${detail}` : "";
  if (status === 401) return new ProviderError(`ElevenLabs rejected the API key (401)${d}`, status, false);
  if (status === 403) return new ProviderError(`ElevenLabs denied the request (403) — check the key's text-to-speech permission and plan${d}`, status, false);
  if (status === 404) return new ProviderError(`ElevenLabs voice not found (404)${d}`, status, false);
  if (status === 422 || status === 400) return new ProviderError(`ElevenLabs rejected the request (${status})${d}`, status, false);
  if (status === 429) return new ProviderError(`ElevenLabs rate limit / quota exceeded (429)${d}`, status, true);
  if (status >= 500) return new ProviderError(`ElevenLabs is having problems (${status})${d}`, status, true);
  return new ProviderError(`ElevenLabs responded ${status}${d}`, status, false);
}

class ElevenLabsVoiceProvider implements VoiceProvider {
  readonly name = "elevenlabs";

  async synthesize(text: string, voiceOverride: string | undefined, languageCode?: string) {
    const v = await requireConnected("elevenlabs", "ElevenLabs");
    const voiceId = voiceOverride || v.voiceId;
    if (!voiceId) throw new ProviderError("No ElevenLabs voice selected — set a default voice ID in Integrations → ElevenLabs", null, false);
    const model = v.model || "eleven_multilingual_v2";
    return withRetry(async () => {
      const { res } = await timedFetch(
        `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=mp3_44100_128`,
        {
          method: "POST",
          headers: { "xi-api-key": v.apiKey ?? "", "Content-Type": "application/json", Accept: "audio/mpeg" },
          body: JSON.stringify({
            text,
            model_id: model,
            ...(languageCode && /^[a-z]{2}$/.test(languageCode) && model.includes("turbo") ? { language_code: languageCode } : {}),
            voice_settings: { stability: 0.5, similarity_boost: 0.75, style: 0.2, use_speaker_boost: true },
          }),
        },
        120_000,
      );
      if (!res.ok) throw elevenError(res.status, scrubSecrets((await readErrorDetail(res)) ?? "", [v.apiKey]));
      const audio = Buffer.from(await res.arrayBuffer());
      if (audio.length < 1000) throw new ProviderError("ElevenLabs returned an empty audio file", null, true);
      return { audio, requestId: res.headers.get("request-id") ?? res.headers.get("x-request-id"), voiceId, model };
    });
  }
}

export const voiceProvider: VoiceProvider = new ElevenLabsVoiceProvider();
