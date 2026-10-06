/**
 * Social-posting autopilot gate — native port of n8n workflow 10's one real
 * business rule (its "Select Next Post" node): never auto-post unless the
 * admin has explicitly turned autopilot on, and the emergency stop always
 * wins. The old workflow routed through Buffer/a Google-Sheets draft queue;
 * this gate instead guards the native per-platform publish path
 * (worker/src/delivery/publish.ts + publish-carousel.ts), which already
 * posts for real — this file only decides whether that's allowed to happen
 * automatically right now, or must wait for a human.
 *
 * Settings reused as-is (already existed, were only ever delivered to n8n
 * via runtimeEnv.ts, never enforced by the native approve → publish path):
 *   autopilotStop            — emergency stop, overrides everything
 *   autopilotSocialPosting   — overall opt-in; off = manual for every platform
 *   twitterPostingEnabled    — extra per-platform gate, X only (workflow 10's own distinction)
 */
import { getSetting } from "../settings/schema";

export interface AutopilotDecision {
  allowed: boolean;
  /** Present only when `allowed` is false — why this target must be posted manually. */
  reason?: string;
}

export interface AutopilotSettings {
  autopilotStop: boolean;
  autopilotSocialPosting: boolean;
  twitterPostingEnabled: boolean;
}

/** Pure — no DB — so the gate order (stop > opt-in > per-platform) is directly testable. */
export function evaluateAutopilot(settings: AutopilotSettings, target: string): AutopilotDecision {
  if (settings.autopilotStop) return { allowed: false, reason: "Emergency stop is on (Settings → Automation safety)" };
  if (!settings.autopilotSocialPosting) return { allowed: false, reason: "Automatic social posting is off (Settings → Automation safety)" };
  if (target === "x" && !settings.twitterPostingEnabled) return { allowed: false, reason: "X posting is off (Settings → Automation safety)" };
  return { allowed: true };
}

export async function checkAutopilot(target: string): Promise<AutopilotDecision> {
  const [autopilotStop, autopilotSocialPosting, twitterPostingEnabled] = await Promise.all([
    getSetting<boolean>("autopilotStop"),
    getSetting<boolean>("autopilotSocialPosting"),
    getSetting<boolean>("twitterPostingEnabled"),
  ]);
  return evaluateAutopilot({ autopilotStop, autopilotSocialPosting, twitterPostingEnabled }, target);
}
