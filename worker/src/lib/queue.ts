import IORedis from "ioredis";

// Keep in sync with api/src/lib/queue.ts — see the note there.
export const VIDEO_QUEUE_NAME = "video-generation";
export const DELIVERY_QUEUE_NAME = "video-delivery";
export const CAROUSEL_QUEUE_NAME = "carousel-generation";
export const WHATSAPP_NURTURE_QUEUE_NAME = "whatsapp-nurture";
export const WHATSAPP_WELCOME_QUEUE_NAME = "whatsapp-welcome";
export const WHATSAPP_ENGAGEMENT_QUEUE_NAME = "whatsapp-engagement";
export const WEEKLY_REPORT_QUEUE_NAME = "weekly-report";
export const CONTENT_MULTIPLICATION_QUEUE_NAME = "content-multiplication";
export const AUTOPILOT_CONTROLLER_QUEUE_NAME = "autopilot-controller";

export interface VideoGenerationJobPayload {
  videoJobId: string;
}

export interface CarouselGenerationJobPayload {
  carouselJobId: string;
}

export interface WhatsAppNurtureJobPayload {
  trigger: "scheduled" | "manual";
}

export interface WeeklyReportJobPayload {
  trigger: "scheduled" | "manual";
}

export interface ContentMultiplicationJobPayload {
  idea: string;
  requestedBy: string;
}

export interface AutopilotControllerJobPayload {
  trigger: "scheduled" | "manual";
}

export type DeliveryJobPayload =
  | { kind: "send-approval"; videoJobId: string; requestedBy: string }
  | { kind: "publish"; videoJobId: string; target: string; connectedAccountId?: string; requestedBy: string }
  | { kind: "send-carousel-approval"; carouselJobId: string; requestedBy: string }
  | { kind: "publish-carousel"; carouselJobId: string; target: string; connectedAccountId?: string; requestedBy: string };

export function getRedisConnection(): IORedis {
  const url = process.env.REDIS_URL;
  if (!url) throw new Error("REDIS_URL is not set.");
  // family 0: resolve IPv4 + IPv6 (Railway private networking is IPv6).
  return new IORedis(url, { maxRetriesPerRequest: null, family: 0 });
}
