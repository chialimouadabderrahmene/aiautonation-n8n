/**
 * Common interface every AI provider adapter implements — script.ts,
 * slides.ts and critic.ts all call exactly this, never a provider-specific
 * shape. Adapters solve ONE problem (get the assistant's raw text reply out
 * of that provider's own API); JSON extraction + zod validation stays once,
 * in each caller, exactly as it already was — not duplicated per provider.
 */
export interface ChatJSONRequest {
  system: string;
  user: string;
  temperature?: number;
  timeoutMs?: number;
  /** Which workflow this call serves, recorded with its usage. Optional: an unlabelled call is still recorded. */
  usageContext?: { workflowKey?: string; executionRef?: string };
}

export interface ChatJSONResult {
  /** The assistant's raw text reply — callers parse/validate it as JSON themselves. */
  raw: string;
  provider: string;
  model: string;
}

export interface AIProvider {
  key: string;
  model: string;
  chatJSON(req: ChatJSONRequest): Promise<ChatJSONResult>;
}
