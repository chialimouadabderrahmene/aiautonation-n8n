export function formatMicros(micros: number): string {
  if (!Number.isFinite(micros) || micros < 0) return "Unknown";
  return `$${(micros / 1_000_000).toFixed(4)}`;
}

export function usageLabel(status: "PROVIDER_REPORTED" | "ESTIMATE" | "UNKNOWN"): string {
  return status === "PROVIDER_REPORTED" ? "Provider reported" : status === "ESTIMATE" ? "Estimate" : "Unknown cost";
}
