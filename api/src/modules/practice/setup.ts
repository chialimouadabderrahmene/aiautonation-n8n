import { prisma } from "../../lib/prisma";

export interface SetupStep {
  id: string;
  title: string;
  why: string;
  /** Any one connected provider completes the step. An empty list means the step is not a provider. */
  providers: string[];
  /** Must be done before going live. Everything else switches on a feature when you add it. */
  required: boolean;
  done: boolean;
  doneWith: string[];
}

const STEPS: Omit<SetupStep, "done" | "doneWith">[] = [
  { id: "brand", title: "Teach Eki your voice", why: "So every script and post sounds like you, not like a robot.", providers: [], required: true },
  { id: "writer", title: "Connect the AI writer", why: "It writes scripts, captions and replies. Pick any one.", providers: ["openai", "groq", "codecraft"], required: true },
  { id: "voice", title: "Connect the voice", why: "Reads your video scripts out loud.", providers: ["elevenlabs"], required: false },
  { id: "video", title: "Connect the video maker", why: "Films each scene of your reels.", providers: ["runway"], required: false },
  { id: "social", title: "Connect your social accounts", why: "Where approved content gets posted.", providers: ["meta", "x", "linkedin", "buffer"], required: false },
  { id: "whatsapp", title: "Connect WhatsApp", why: "Replies to leads and follows up automatically.", providers: ["whatsapp"], required: false },
  { id: "telegram", title: "Approve from your phone", why: "Optional. Approve or reject from Telegram as well as in here.", providers: ["telegram"], required: false },
  { id: "email", title: "Connect email", why: "Sends waitlist emails and your Monday report.", providers: ["resend"], required: false },
];

export async function getSetupSteps(): Promise<{ steps: SetupStep[]; done: number; total: number; canGoLive: boolean }> {
  const integrations = await prisma.integration.findMany({ select: { provider: true, status: true } });
  const connected = new Set(integrations.filter((i) => i.status === "CONNECTED").map((i) => i.provider));
  const brand = await prisma.brandProfile.findFirst({ where: { isActive: true }, select: { name: true } });
  const steps = STEPS.map((s) => {
    const doneWith = s.providers.filter((p) => connected.has(p));
    const done = s.id === "brand" ? Boolean(brand && !brand.name.includes("(starter)")) : doneWith.length > 0;
    return { ...s, done, doneWith };
  });
  return { steps, done: steps.filter((s) => s.done).length, total: steps.length, canGoLive: steps.filter((s) => s.required).every((s) => s.done) };
}
