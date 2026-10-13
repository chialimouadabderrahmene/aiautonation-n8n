/**
 * Declared requirements of each of the 22 workflow files in
 * ../../../../n8n-workflows/*.json, derived from docs/env-vars.md (which
 * `$env` value each workflow reads) and the credentials each file references.
 *
 * Requirement DSL, interpreted by readiness.ts:
 *   "openai|groq"            any of these integrations is CONNECTED
 *   "telegram"               that integration is CONNECTED (tested OK)
 *   "config:<settingKey>"    a business setting is filled in (Settings page)
 *   "field:<provider>.<f>"   an integration's optional field is filled in
 *   "setting:<settingKey>"   a human confirmation is ticked (cannot be checked by API)
 *   "telegram:webhook"       Telegram updates are routed through the Control Center
 *   "worker:ffmpeg"          a live video worker reports ffmpeg/ffprobe
 *   "storage"                object storage for media is configured and reachable
 *
 * The engine ALSO checks, for every workflow, that n8n is connected, the
 * workflow exists in n8n, and every n8n credential it uses has been synced.
 */
export interface WorkflowManifestEntry {
  key: string;
  name: string;
  category: "System" | "Content" | "Lead Automation" | "WhatsApp" | "Social" | "AI" | "Reporting";
  required: string[];
  optional?: string[];
}

const AI = "openai|groq";

export const WORKFLOW_MANIFEST: WorkflowManifestEntry[] = [
  { key: "00-global-error-handler", name: "Global Error Handler", category: "System", required: ["telegram"] },
  { key: "01-ai-content-generation", name: "AI Content Generation", category: "Content", required: [AI, "google-sheets", "telegram", "config:launchDate"] },
  { key: "02-content-approval", name: "Content Approval", category: "Content", required: [AI, "google-sheets", "telegram", "webhooks", "telegram:webhook"] },
  { key: "03-lead-capture-webhook", name: "Lead Capture Webhook", category: "Lead Automation", required: ["google-sheets", "whatsapp", "telegram", "webhooks", "setting:whatsappTemplatesApproved"] },
  { key: "04-waitlist-management", name: "Waitlist Management", category: "Lead Automation", required: ["google-sheets", "whatsapp", "resend", "webhooks", "setting:whatsappTemplatesApproved"] },
  { key: "05-whatsapp-welcome-sequence", name: "WhatsApp Welcome Sequence", category: "WhatsApp", required: ["google-sheets", "whatsapp", "telegram", "setting:whatsappTemplatesApproved"] },
  { key: "06-whatsapp-engagement-followup", name: "WhatsApp Engagement Follow-up", category: "WhatsApp", required: ["google-sheets", "whatsapp", "telegram", "setting:whatsappTemplatesApproved"] },
  { key: "07-referral-campaign", name: "Referral Campaign", category: "Lead Automation", required: ["google-sheets", "resend", "webhooks"] },
  { key: "08-feedback-collection", name: "Feedback Collection", category: "Reporting", required: ["google-sheets", "resend", "telegram", "webhooks", "config:feedbackFormUrl"] },
  { key: "09-weekly-analytics-report", name: "Weekly Analytics Report", category: "Reporting", required: ["google-sheets", "resend", "telegram", "field:resend.teamEmail"] },
  { key: "10-social-post-scheduler", name: "Social Post Scheduler", category: "Social", required: ["google-sheets", "buffer", "telegram"], optional: ["x"] },
  { key: "12-ai-social-autopilot", name: "AI Social Autopilot", category: "Social", required: [AI, "google-sheets", "buffer", "telegram"] },
  { key: "13-whatsapp-lead-funnel", name: "WhatsApp Lead Funnel", category: "WhatsApp", required: ["google-sheets", "whatsapp", "telegram"] },
  { key: "14-autopilot-controller", name: "Autopilot Controller", category: "System", required: [AI, "google-sheets", "whatsapp", "resend", "buffer", "telegram"] },
  { key: "15-viral-intelligence-engine", name: "Viral Intelligence Engine", category: "AI", required: [AI, "google-sheets", "apify", "telegram"] },
  { key: "16-pain-discovery-engine", name: "Pain Discovery Engine", category: "AI", required: [AI, "google-sheets"] },
  { key: "17-manychat-comment-funnel", name: "ManyChat Comment Funnel", category: "Lead Automation", required: ["google-sheets", "telegram", "webhooks"] },
  { key: "18-content-multiplication-engine", name: "Content Multiplication Engine", category: "Content", required: [AI, "google-sheets", "webhooks"] },
  { key: "19-whatsapp-nurture-sequences", name: "WhatsApp Nurture Sequences", category: "WhatsApp", required: ["google-sheets", "whatsapp", "telegram", "setting:whatsappTemplatesApproved"] },
  { key: "20-ab-testing-engine", name: "A/B Testing Engine", category: "AI", required: [AI, "google-sheets", "telegram"] },
  { key: "21-social-proof-engine", name: "Social Proof Engine", category: "Social", required: [AI, "google-sheets", "telegram", "webhooks"] },
  { key: "22-performance-analyst-agent", name: "Performance Analyst Agent", category: "Reporting", required: [AI, "google-sheets", "resend", "telegram", "field:resend.teamEmail"] },
];

/** The video pipeline is not an n8n workflow; it has its own requirement set. */
export const VIDEO_PIPELINE_REQUIREMENTS = [AI, "runway", "elevenlabs", "worker:ffmpeg", "storage"];
/** Needed to send a finished video for APPROVE / REJECT. */
export const VIDEO_APPROVAL_REQUIREMENTS = ["telegram", "telegram:webhook"];
/** The carousel/slideshow pipeline — no Runway/ElevenLabs, it renders stills with ffmpeg. */
export const CAROUSEL_PIPELINE_REQUIREMENTS = [AI, "worker:ffmpeg", "storage"];
