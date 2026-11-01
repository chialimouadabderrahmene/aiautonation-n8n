import type { AutomationExecution } from "./types";

/** Trigger the API stamps on executions created from Eki account-created events. */
export const SIGNUP_TRIGGER = "eki_signup";

export function isSignupExecution(e: Pick<AutomationExecution, "trigger">): boolean {
  return e.trigger === SIGNUP_TRIGGER;
}

/** Row title for an execution: workflow name, signup kind, video job, or related id. */
export function executionTitle(e: Pick<AutomationExecution, "workflowConfig" | "trigger" | "mode" | "relatedEntityType" | "relatedEntityId">): string {
  if (e.workflowConfig?.name) return e.workflowConfig.name;
  if (isSignupExecution(e)) return e.mode === "vendor_store_created" ? "Eki signup · vendor store" : "Eki signup · new account";
  if (e.relatedEntityType === "VideoJob") return "Video job";
  return e.relatedEntityId ?? "—";
}

/** Human trigger label for the Trigger column. */
export function triggerLabel(trigger: string | null): string {
  if (trigger === SIGNUP_TRIGGER) return "Eki marketplace signup";
  return trigger ?? "—";
}
