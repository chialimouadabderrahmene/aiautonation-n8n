import { prisma } from "../../lib/prisma";
import { recordAudit } from "../audit/audit";
import { aiComplete } from "../senders/ai";
import { ContentDraftStatus } from "@prisma/client";

/**
 * Native replacement for n8n 02-content-approval.json's "Parse Command" -> "Route Action"
 * chain, reusing Meta's own Telegram update shape — called directly from the existing
 * Telegram webhook route (routes/approvals.ts), the same place video approve/reject button
 * presses are already handled, rather than as a second EngineWorkflow. There is no engine
 * EVENT/CRON trigger for a Telegram text command in this project (the video-approval flow
 * sets the precedent: Telegram command handling is route-level code, not a workflow), so this
 * module is plain, directly-callable logic — see docs/WORKFLOW_ENGINE.md for why.
 *
 * The regex and command grammar (/approve <day>, /reject <day>, /edit <day> <feedback>) are
 * reproduced from the n8n original's "Parse Command" node verbatim.
 */
const COMMAND = /^\/(approve|reject|edit)(?:@\w+)?\s+(\d+)(?:\s+([\s\S]+))?$/i;

export interface CommandResult {
  handled: boolean;
  replyText?: string;
}

export async function handleContentApprovalCommand(text: string): Promise<CommandResult> {
  const m = text.trim().match(COMMAND);
  if (!m) return { handled: false };
  const action = m[1]!.toLowerCase() as "approve" | "reject" | "edit";
  const dayNumber = Number.parseInt(m[2]!, 10);
  const feedback = (m[3] ?? "").trim();
  if (action === "edit" && !feedback) return { handled: true, replyText: "Usage: /edit <day> <your feedback>" };

  const draft = await prisma.engineContentDraft.findFirst({ where: { source: "ai-content-generation", dayNumber }, orderBy: { createdAt: "desc" } });
  if (!draft) return { handled: true, replyText: `No content draft found for day ${dayNumber}.` };

  if (action === "approve") {
    if (draft.status !== ContentDraftStatus.DRAFT && draft.status !== ContentDraftStatus.QUEUED) {
      return { handled: true, replyText: `Day ${dayNumber} is already ${draft.status.toLowerCase()}.` };
    }
    await prisma.engineContentDraft.update({ where: { id: draft.id }, data: { status: ContentDraftStatus.APPROVED, reviewedAt: new Date(), reviewedBy: "telegram" } });
    await recordAudit("telegram", "engine.content_draft.approved", "EngineContentDraft", draft.id, { dayNumber, via: "telegram_command" });
    return { handled: true, replyText: `✅ Day ${dayNumber} approved.` };
  }

  if (action === "reject") {
    if (draft.status !== ContentDraftStatus.DRAFT && draft.status !== ContentDraftStatus.QUEUED) {
      return { handled: true, replyText: `Day ${dayNumber} is already ${draft.status.toLowerCase()}.` };
    }
    await prisma.engineContentDraft.update({ where: { id: draft.id }, data: { status: ContentDraftStatus.REJECTED, reviewedAt: new Date(), reviewedBy: "telegram" } });
    await recordAudit("telegram", "engine.content_draft.rejected", "EngineContentDraft", draft.id, { dayNumber, via: "telegram_command" });
    return { handled: true, replyText: `❌ Day ${dayNumber} rejected.` };
  }

  // edit: ask the AI to revise using the SAME prompt n8n's "Build Revision Request" node used,
  // then overwrite the existing draft (same day_number, status back to DRAFT for re-approval)
  // — reproducing the n8n original's own "Save Revision" upsert-by-day_number behavior.
  const meta = draft.metadata as { hook?: string; videoScript?: string };
  const system =
    'You are a professional social media content creator for Eki, a digital marketplace connecting African foodstuff vendors with global buyers. Revise the provided social post draft based on user feedback. Do not invent statistics, testimonials, prices, or guarantees. Retain the same output JSON structure:\n{\n  "hook": "One scroll-stopping sentence",\n  "caption": "Engagement caption (50-150 words) with emojis",\n  "hashtags": "#Hashtags #EkiMarket",\n  "video_script": "Short-form 30-sec script with visual cues in brackets"\n}';
  const user = `Original Hook: ${meta.hook ?? ""}\nOriginal Caption: ${draft.body}\nOriginal Video Script: ${meta.videoScript ?? ""}\n\nFeedback for revision: ${feedback}`;
  const result = await aiComplete({ system, user });
  if (!result.ok) return { handled: true, replyText: `Could not revise day ${dayNumber}: ${result.message}` };
  const ai = result.json as Record<string, unknown>;
  const fields = ["hook", "caption", "hashtags", "video_script"] as const;
  const missing = fields.filter((f) => typeof ai[f] !== "string" || !(ai[f] as string).trim());
  if (missing.length) return { handled: true, replyText: `AI revision for day ${dayNumber} was missing field(s): ${missing.join(", ")} — not saved.` };
  const hook = String(ai.hook).trim();
  const caption = String(ai.caption).trim();
  const hashtags = String(ai.hashtags).trim();
  const videoScript = String(ai.video_script).trim();

  await prisma.engineContentDraft.update({
    where: { id: draft.id },
    data: { body: caption, hashtags: hashtags.split(/\s+/).filter((h) => h.startsWith("#")), status: ContentDraftStatus.DRAFT, reviewedAt: null, reviewedBy: null, metadata: { hook, videoScript, hashtagsRaw: hashtags } },
  });
  await recordAudit("telegram", "engine.content_draft.revised", "EngineContentDraft", draft.id, { dayNumber, feedback: feedback.slice(0, 300) });
  const approvalText = `Revised Eki content draft for day ${dayNumber}\n\nPlatform: ${draft.platform}\n\nHook: ${hook}\n\nCaption:\n${caption}\n\nHashtags: ${hashtags}\n\nVideo script:\n${videoScript}\n\nReply with:\n/approve ${dayNumber}\n/reject ${dayNumber}\n/edit ${dayNumber} [your edits]`;
  return { handled: true, replyText: approvalText };
}
