import { getDecryptedCredentials } from "../lib/credentials";
import { storage } from "../lib/storage";

export interface VoiceProvider {
  generateSpeech(text: string, voiceId: string | undefined): Promise<Buffer>;
}

class ElevenLabsVoiceProvider implements VoiceProvider {
  async generateSpeech(text: string, voiceId: string | undefined): Promise<Buffer> {
    const creds = await getDecryptedCredentials("elevenlabs");
    if (!creds?.secrets.apiKey) throw new Error("ElevenLabs is not configured.");

    const voice = voiceId || creds.config.voiceId;
    if (!voice) throw new Error("No ElevenLabs voice selected (set a default voice in Integrations, or per-project).");

    const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voice}`, {
      method: "POST",
      headers: {
        "xi-api-key": creds.secrets.apiKey,
        "Content-Type": "application/json",
        Accept: "audio/mpeg",
      },
      body: JSON.stringify({
        text,
        model_id: creds.config.model || "eleven_multilingual_v2",
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`ElevenLabs responded ${res.status}: ${body.slice(0, 300)}`);
    }
    return Buffer.from(await res.arrayBuffer());
  }
}

export const voiceProvider: VoiceProvider = new ElevenLabsVoiceProvider();

export async function generateVoiceover(jobId: string, fullNarration: string, voicePreset: string | undefined): Promise<string> {
  const audio = await voiceProvider.generateSpeech(fullNarration, voicePreset);
  return storage.save(`${jobId}/voiceover.mp3`, audio);
}
