import { timedFetch, describeHttpFailure, readErrorDetail } from "../../lib/http";
import { getProviderValues } from "../integrations/vault";

const META_GRAPH = "https://graph.facebook.com";

export interface WhatsAppConfig {
  accessToken: string;
  phoneNumberId: string;
  appSecret: string;
  verifyToken: string;
  graphVersion: string;
}

export async function getWhatsAppConfig(): Promise<WhatsAppConfig | null> {
  const v = await getProviderValues("whatsapp");
  if (!v?.accessToken || !v?.phoneNumberId || !v?.appSecret || !v?.verifyToken) return null;
  return { accessToken: v.accessToken, phoneNumberId: v.phoneNumberId, appSecret: v.appSecret, verifyToken: v.verifyToken, graphVersion: v.graphVersion || "v23.0" };
}

/** A free-form session reply — only valid within 24h of the contact's last inbound message, same rule workflow 13 operated under. */
export async function sendWhatsAppText(config: WhatsAppConfig, toPhone: string, text: string): Promise<void> {
  const { res } = await timedFetch(
    `${META_GRAPH}/${config.graphVersion}/${encodeURIComponent(config.phoneNumberId)}/messages`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${config.accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ messaging_product: "whatsapp", to: toPhone, type: "text", text: { body: text.slice(0, 4096), preview_url: false } }),
    },
    20_000,
  );
  if (!res.ok) throw describeHttpFailure("WhatsApp", res.status, await readErrorDetail(res));
}
