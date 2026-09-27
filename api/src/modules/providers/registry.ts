/**
 * Provider registry: lookup, input validation and the public (secret-free)
 * schema the Integrations UI renders forms from. Definitions live in
 * ./definitions.ts, the contract in ./types.ts.
 */
import { PROVIDERS } from "./definitions";
import { ProviderDefinition, ProviderField } from "./types";

export { PROVIDERS };
export type { ProviderDefinition, ProviderField } from "./types";
export type { IntegrationCategory, TestResult } from "./types";

export function getProvider(key: string): ProviderDefinition | undefined {
  return PROVIDERS.find((p) => p.key === key);
}

/** Schema safe to send to the browser: no functions, no secrets. */
export function publicProviderSchema(p: ProviderDefinition) {
  return {
    key: p.key,
    label: p.label,
    category: p.category,
    authType: p.authType,
    description: p.description,
    docsUrl: p.docsUrl,
    caveat: p.caveat,
    oauth: p.oauth ? { scopes: p.oauth.scopes } : undefined,
    fields: p.fields.map((f) => ({
      name: f.name,
      label: f.label,
      type: f.type,
      secret: f.secret,
      required: f.required,
      placeholder: f.placeholder,
      default: f.default,
      help: f.help,
      options: f.options,
      pattern: f.pattern,
      patternMessage: f.patternMessage,
      group: f.group,
      generatable: f.generatable,
    })),
  };
}

export interface FieldError {
  field: string;
  message: string;
}

function validateValue(field: ProviderField, value: string): string | null {
  if (field.type === "url") {
    try {
      const u = new URL(value);
      if (u.protocol !== "http:" && u.protocol !== "https:") return "Must be an http(s) URL";
    } catch {
      return "Must be a valid URL";
    }
  }
  if (field.type === "email" && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value)) return "Must be a valid email address";
  if (field.type === "number" && !/^-?\d+(\.\d+)?$/.test(value)) return "Must be a number";
  if (field.type === "json") {
    try {
      JSON.parse(value);
    } catch {
      return "Must be valid JSON";
    }
  }
  if (field.type === "select" && field.options && !field.options.some((o) => o.value === value)) {
    return `Must be one of: ${field.options.map((o) => o.value).join(", ")}`;
  }
  if (field.pattern && !new RegExp(field.pattern).test(value)) return field.patternMessage ?? "Invalid format";
  return null;
}

/**
 * Validates an Integrations form submission. `storedSecretNames` lets a
 * required secret be omitted on update (blank = keep the stored value).
 * Unknown field names are rejected so nothing unexpected is ever persisted.
 */
export function validateProviderInput(
  def: ProviderDefinition,
  secrets: Record<string, string>,
  config: Record<string, string>,
  storedSecretNames: Set<string>,
): FieldError[] {
  const errors: FieldError[] = [];
  const byName = new Map(def.fields.map((f) => [f.name, f]));

  for (const name of Object.keys(secrets)) {
    const f = byName.get(name);
    if (!f || !f.secret) errors.push({ field: name, message: "Unknown secret field" });
  }
  for (const name of Object.keys(config)) {
    const f = byName.get(name);
    if (!f || f.secret) errors.push({ field: name, message: "Unknown setting" });
  }

  for (const f of def.fields) {
    const raw = f.secret ? secrets[f.name] : config[f.name];
    const value = raw?.trim() ?? "";
    if (!value) {
      const satisfied = f.secret ? storedSecretNames.has(f.name) : Boolean(f.default);
      if (f.required && !satisfied) errors.push({ field: f.name, message: `${f.label} is required` });
      continue;
    }
    const problem = validateValue(f, value);
    if (problem) errors.push({ field: f.name, message: `${f.label}: ${problem}` });
  }

  if (def.key === "google-sheets" && secrets.serviceAccountJson) {
    try {
      const j = JSON.parse(secrets.serviceAccountJson) as Record<string, unknown>;
      if (j.type !== "service_account" || !j.client_email || !j.private_key) {
        errors.push({ field: "serviceAccountJson", message: "Not a service account key file (needs type, client_email, private_key)" });
      }
    } catch {
      /* reported above */
    }
  }
  return errors;
}
