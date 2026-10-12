import { prisma } from "../../lib/prisma";
import { getProviderValues } from "../integrations/vault";
import { getSetting } from "../settings/schema";
import { timedFetch, describeHttpFailure, readErrorDetail, withRetry } from "../../lib/http";
import { templateFieldName } from "../providers/definitions";

export type SendTemplateResult =
  | { ok: true; messageId: string }
  | { ok: false; reason: "not_configured" | "template_not_set" | "templates_not_approved" | "provider_error"; message: string };

/**
 * Sends a Meta-approved WhatsApp template message. Business-initiated WhatsApp messages
 * outside the 24h session window MUST use an approved template — this never sends free-form
 * text, mirroring the n8n workflows it replaces (03/04/05/06/13/19).
 */
export async function sendWhatsAppTemplate(input: { to: string; templateKey: string; params?: string[] }): Promise<SendTemplateResult> {
  const approved = await getSetting<boolean>("whatsappTemplatesApproved").catch(() => false);
  if (!approved) return { ok: false, reason: "templates_not_approved", message: "Settings → WhatsApp templates are not confirmed as Meta-approved." };
  const integration = await prisma.integration.findUnique({ where: { provider: "whatsapp" } });
  if (integration?.status !== "CONNECTED") return { ok: false, reason: "not_configured", message: "WhatsApp is not connected." };
  const v = await getProviderValues("whatsapp");
  if (!v?.accessToken || !v?.phoneNumberId) return { ok: false, reason: "not_configured", message: "WhatsApp access token or phone number id missing." };
  const templateName = v[templateFieldName(input.templateKey)];
  if (!templateName) return { ok: false, reason: "template_not_set", message: `No template name configured for ${input.templateKey} — that step is skipped by design until it is set.` };
  const version = v.graphVersion || "v23.0";
  try {
    const data = await withRetry(async () => {
      const { res } = await timedFetch(`https://graph.facebook.com/${version}/${v.phoneNumberId}/messages`, {
        method: "POST",
        headers: { Authorization: `Bearer ${v.accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          to: input.to,
          type: "template",
          template: {
            name: templateName,
            language: { code: v.templateLang || "en" },
            ...(input.params?.length ? { components: [{ type: "body", parameters: input.params.map((text) => ({ type: "text", text })) }] } : {}),
          },
        }),
      });
      if (!res.ok) throw describeHttpFailure("WhatsApp (Meta)", res.status, await readErrorDetail(res));
      return (await res.json()) as { messages?: { id: string }[] };
    });
    const id = data.messages?.[0]?.id;
    if (!id) return { ok: false, reason: "provider_error", message: "WhatsApp accepted the request but returned no message id." };
    return { ok: true, messageId: id };
  } catch (err) {
    return { ok: false, reason: "provider_error", message: err instanceof Error ? err.message : String(err) };
  }
}

export type SendSessionTextResult =
  | { ok: true; messageId: string }
  | { ok: false; reason: "not_configured" | "provider_error"; message: string };

/**
 * Sends a free-form text reply within the 24h "customer service window" opened by an inbound
 * message — this is the ONE place free text is allowed, per Meta's messaging policy (business-
 * INITIATED messages must use an approved template; session REPLIES to a customer's own inbound
 * message may be free text). Deliberately does NOT gate on `whatsappTemplatesApproved` — that
 * setting is about templates, which this path never uses. Used only by workflow 13's inbound
 * conversation handler (whatsapp.processInboundMessage), never by a business-initiated workflow.
 */
export async function sendWhatsAppSessionText(input: { to: string; text: string }): Promise<SendSessionTextResult> {
  const integration = await prisma.integration.findUnique({ where: { provider: "whatsapp" } });
  if (integration?.status !== "CONNECTED") return { ok: false, reason: "not_configured", message: "WhatsApp is not connected." };
  const v = await getProviderValues("whatsapp");
  if (!v?.accessToken || !v?.phoneNumberId) return { ok: false, reason: "not_configured", message: "WhatsApp access token or phone number id missing." };
  const version = v.graphVersion || "v23.0";
  try {
    const data = await withRetry(async () => {
      const { res } = await timedFetch(`https://graph.facebook.com/${version}/${v.phoneNumberId}/messages`, {
        method: "POST",
        headers: { Authorization: `Bearer ${v.accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ messaging_product: "whatsapp", recipient_type: "individual", to: input.to, type: "text", text: { preview_url: false, body: input.text } }),
      });
      if (!res.ok) throw describeHttpFailure("WhatsApp (Meta)", res.status, await readErrorDetail(res));
      return (await res.json()) as { messages?: { id: string }[] };
    });
    const id = data.messages?.[0]?.id;
    if (!id) return { ok: false, reason: "provider_error", message: "WhatsApp accepted the request but returned no message id." };
    return { ok: true, messageId: id };
  } catch (err) {
    return { ok: false, reason: "provider_error", message: err instanceof Error ? err.message : String(err) };
  }
}
