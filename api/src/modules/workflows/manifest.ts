/**
 * Declared provider/config dependencies for each of the 22 workflow files in
 * ../../../n8n-workflows/*.json. Sourced directly from this repo's own
 * docs/env-vars.md (which env var each workflow reads) — not invented.
 *
 * Requirement DSL (strings), interpreted by readiness.ts:
 *   "openai|groq"        → anyOf: satisfied if either is CONNECTED
 *   "telegram"            → provider: must be CONNECTED
 *   "setting:xyz"         → a manual boolean flag under Setting("xyz")
 *                           (things no API can verify, e.g. "these 15
 *                           WhatsApp templates were approved by Meta")
 */
export interface WorkflowManifestEntry {
  key: string;
  name: string;
  category:
    | "System"
    | "Content"
    | "Lead Automation"
    | "WhatsApp"
    | "Social"
    | "AI"
    | "Reporting";
  required: string[];
  optional?: string[];
}

export const WORKFLOW_MANIFEST: WorkflowManifestEntry[] = [
  { key: "00-global-error-handler", name: "Global Error Handler", category: "System", required: ["telegram"] },
  { key: "01-ai-content-generation", name: "AI Content Generation", category: "Content", required: ["openai|groq", "google-sheets", "telegram"] },
  { key: "02-content-approval", name: "Content Approval", category: "Content", required: ["openai|groq", "google-sheets", "telegram"] },
  { key: "03-lead-capture-webhook", name: "Lead Capture Webhook", category: "Lead Automation", required: ["google-sheets", "whatsapp", "telegram", "setting:whatsappTemplatesApproved"] },
  { key: "04-waitlist-management", name: "Waitlist Management", category: "Lead Automation", required: ["google-sheets", "whatsapp", "resend", "setting:whatsappTemplatesApproved"] },
  { key: "05-whatsapp-welcome-sequence", name: "WhatsApp Welcome Sequence", category: "WhatsApp", required: ["google-sheets", "whatsapp", "telegram", "setting:whatsappTemplatesApproved"] },
  { key: "06-whatsapp-engagement-followup", name: "WhatsApp Engagement Followup", category: "WhatsApp", required: ["google-sheets", "whatsapp", "telegram", "setting:whatsappTemplatesApproved"] },
  { key: "07-referral-campaign", name: "Referral Campaign", category: "Lead Automation", required: ["google-sheets", "resend"] },
  { key: "08-feedback-collection", name: "Feedback Collection", category: "Reporting", required: ["google-sheets", "resend", "telegram"], optional: ["setting:feedbackFormConfigured"] },
  { key: "09-weekly-analytics-report", name: "Weekly Analytics Report", category: "Reporting", required: ["google-sheets", "resend", "telegram"] },
  { key: "10-social-post-scheduler", name: "Social Post Scheduler", category: "Social", required: ["google-sheets", "buffer", "telegram"], optional: ["x"] },
  { key: "12-ai-social-autopilot", name: "AI Social Autopilot", category: "Social", required: ["openai|groq", "google-sheets", "buffer", "telegram", "setting:autopilotSocialPostingEnabled"] },
  { key: "13-whatsapp-lead-funnel", name: "WhatsApp Lead Funnel", category: "WhatsApp", required: ["google-sheets", "whatsapp", "telegram"] },
  { key: "14-autopilot-controller", name: "Autopilot Controller", category: "System", required: ["openai|groq", "google-sheets", "whatsapp", "resend", "buffer", "telegram"] },
  { key: "15-viral-intelligence-engine", name: "Viral Intelligence Engine", category: "AI", required: ["openai|groq", "google-sheets", "apify", "telegram"] },
  { key: "16-pain-discovery-engine", name: "Pain Discovery Engine", category: "AI", required: ["openai|groq", "google-sheets"] },
  { key: "17-manychat-comment-funnel", name: "ManyChat Comment Funnel", category: "Lead Automation", required: ["google-sheets", "telegram"] },
  { key: "18-content-multiplication-engine", name: "Content Multiplication Engine", category: "Content", required: ["openai|groq", "google-sheets"] },
  { key: "19-whatsapp-nurture-sequences", name: "WhatsApp Nurture Sequences", category: "WhatsApp", required: ["google-sheets", "whatsapp", "telegram", "setting:whatsappTemplatesApproved"] },
  { key: "20-ab-testing-engine", name: "A/B Testing Engine", category: "AI", required: ["openai|groq", "google-sheets", "telegram"] },
  { key: "21-social-proof-engine", name: "Social Proof Engine", category: "Social", required: ["openai|groq", "google-sheets", "telegram"] },
  { key: "22-performance-analyst-agent", name: "Performance Analyst Agent", category: "Reporting", required: ["openai|groq", "google-sheets", "resend", "telegram"] },
];
