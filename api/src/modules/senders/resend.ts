import { outboundStopResult } from "../../lib/outbound-guard";
import { prisma } from "../../lib/prisma";
import { getProviderValues } from "../integrations/vault";
import { timedFetch, describeHttpFailure, readErrorDetail, withRetry } from "../../lib/http";

export type SendEmailResult = { ok: true; id: string } | { ok: false; reason: "not_configured" | "provider_error" | "emergency_stop"; message: string };

/**
 * Sends a transactional email via Resend. Honest result: NOT_CONFIGURED is reported as such
 * and is never confused with a real send — the engine's action layer records this verbatim in
 * EngineStepExecution.output, so "sent" never means anything but a verified 2xx from Resend.
 */
export async function sendEmail(input: { to: string; subject: string; html: string }): Promise<SendEmailResult> {
  const stopped = await outboundStopResult("email_send");
  if (stopped) return stopped;
  const integration = await prisma.integration.findUnique({ where: { provider: "resend" } });
  if (integration?.status !== "CONNECTED") return { ok: false, reason: "not_configured", message: "Resend is not connected — configure it in Integrations." };
  const v = await getProviderValues("resend");
  if (!v?.apiKey || !v?.fromEmail) return { ok: false, reason: "not_configured", message: "Resend API key or from-address missing." };
  try {
    const data = await withRetry(async () => {
      const { res } = await timedFetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${v.apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from: v.fromEmail, to: [input.to], subject: input.subject, html: input.html }),
      });
      if (!res.ok) throw describeHttpFailure("Resend", res.status, await readErrorDetail(res));
      return (await res.json()) as { id: string };
    });
    return { ok: true, id: data.id };
  } catch (err) {
    return { ok: false, reason: "provider_error", message: err instanceof Error ? err.message : String(err) };
  }
}
