/**
 * Shared WhatsApp approved-template sender — factored out of
 * pipeline/whatsapp-nurture.ts so the welcome (05) and engagement (06)
 * sequences don't each duplicate the same Graph API call.
 */
import { timedFetch, describeHttpFailure, readErrorDetail } from "./http";

export interface WhatsAppCreds {
  accessToken: string;
  phoneNumberId: string;
  graphVersion?: string;
  templateLang?: string;
  maxPerRun?: string;
  [templateField: string]: string | undefined;
}

export async function sendWhatsAppTemplate(creds: WhatsAppCreds, toPhone: string, templateName: string, bodyParams: string[]): Promise<void> {
  const ver = creds.graphVersion || "v23.0";
  const lang = creds.templateLang || "en";
  const clean = (s: string) => s.replace(/[\r\n\t]+/g, " ").slice(0, 900) || "-";
  const { res } = await timedFetch(
    `https://graph.facebook.com/${ver}/${encodeURIComponent(creds.phoneNumberId)}/messages`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${creds.accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: toPhone.replace(/\D/g, ""),
        type: "template",
        template: { name: templateName, language: { code: lang }, components: [{ type: "body", parameters: bodyParams.map((p) => ({ type: "text", text: clean(p) })) }] },
      }),
    },
    15_000,
  );
  if (!res.ok) throw describeHttpFailure("WhatsApp", res.status, await readErrorDetail(res));
}
