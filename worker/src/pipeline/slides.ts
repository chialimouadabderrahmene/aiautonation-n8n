import { z } from "zod";
import { timedFetch, describeHttpFailure, readErrorDetail, withRetry, ProviderError } from "../lib/http";
import { chooseProvider } from "../lib/ai-provider";
import { getBrandContext } from "../lib/brand";
import { reviewAgainstBrand } from "./critic";

const slideSchema = z.object({
  index: z.number().int().min(0),
  headline: z.string().min(1).max(120),
  body: z.string().max(400).optional(),
  visualDirection: z.string().min(1).max(500),
});

export const carouselScriptSchema = z.object({
  slides: z.array(slideSchema).min(2).max(10),
  caption: z.string().min(1),
  hashtags: z.array(z.string()).max(15),
});

export type GeneratedCarouselScript = z.infer<typeof carouselScriptSchema>;

export interface CarouselScriptRequest {
  topic: string;
  prompt: string;
  audience?: string | null;
  language: string;
  tone: string;
  brand: string;
  cta?: string | null;
  slideCount: number;
  platform: string;
}

export interface BrandReview {
  reviewed: boolean;
  onBrand: boolean;
  score: number | null;
  violations: string[];
  corrected: boolean;
}

/**
 * Same shape as script.ts's generateScript (AI call -> zod validation ->
 * Brand Brain critic pass), producing N slides instead of video scenes. A
 * carousel is a distinct output (static images, not a rendered video), so
 * this is its own request/response type rather than forcing VideoProject's
 * shape onto it — see schema.prisma's note on CarouselProject.
 */
export async function generateCarouselScript(request: CarouselScriptRequest): Promise<GeneratedCarouselScript & { provider: string; model: string; brandReview: BrandReview }> {
  const ai = await chooseProvider();
  const brand = await getBrandContext();

  const systemPrompt = [
    "You write carousel/slideshow scripts for a real product marketing team — the kind that gets saved and shared on Instagram/LinkedIn.",
    "Return ONLY a JSON object — no markdown — with exactly this shape:",
    '{"slides":[{"index":0,"headline":"...","body":"...","visualDirection":"..."}],"caption":"...","hashtags":["#..."]}',
    `Produce exactly ${request.slideCount} slides, index 0..${request.slideCount - 1}.`,
    "Slide 1 is the hook (a strong headline, thin or no body). The last slide is the call to action.",
    "headline: short, punchy, readable at a glance (max ~8 words). body: optional supporting line, plain language.",
    "visualDirection: what the background image/illustration should show (no text in the image — text is rendered separately), max 400 characters.",
    "Never invent statistics, prices, dates, awards or testimonials that are not in the brief.",
    `Write headline, body and caption in this language: ${request.language}.`,
  ].join(" ");

  const userPrompt = [
    brand.promptBlock,
    `Brand: ${request.brand}`,
    `Platform: ${request.platform} carousel`,
    `Topic: ${request.topic}`,
    `Brief: ${request.prompt}`,
    request.audience ? `Audience: ${request.audience}` : "",
    `Tone: ${request.tone}`,
    request.cta ? `Call to action: ${request.cta}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  const data = await withRetry(async () => {
    const { res } = await timedFetch(
      `${ai.baseUrl}/chat/completions`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${ai.apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: ai.model,
          response_format: { type: "json_object" },
          temperature: 0.7,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
        }),
      },
      90_000,
    );
    if (!res.ok) throw describeHttpFailure(ai.key === "openai" ? "OpenAI" : "Groq", res.status, await readErrorDetail(res));
    return (await res.json()) as { choices: { message: { content: string } }[] };
  });

  const raw = data.choices[0]?.message.content;
  if (!raw) throw new ProviderError("AI provider returned no content", null, true);
  let json: unknown;
  try {
    json = JSON.parse(raw.replace(/^```(?:json)?\s*|\s*```$/g, ""));
  } catch {
    throw new ProviderError("AI provider did not return valid JSON", null, true);
  }
  const parsed = carouselScriptSchema.safeParse(json);
  if (!parsed.success) {
    throw new ProviderError(`AI carousel script failed validation: ${parsed.error.issues.slice(0, 3).map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}`, null, true);
  }
  const slides = parsed.data.slides.sort((a, b) => a.index - b.index).map((s, i) => ({ ...s, index: i }));
  const draft = { ...parsed.data, slides };

  const review = await reviewAgainstBrand(draft, brand, carouselScriptSchema, "slide headlines/body, caption, hashtags");
  return { ...review.content, provider: ai.key, model: ai.model, brandReview: { reviewed: review.reviewed, onBrand: review.onBrand, score: review.score, violations: review.violations, corrected: review.corrected } };
}
