import { getDecryptedCredentials } from "../integrations/vault";

export class N8nNotConfiguredError extends Error {
  constructor() {
    super("n8n is not configured — add its base URL and API key in Integrations, and deploy an instance (see docs/N8N_SETUP.md).");
  }
}

async function n8nRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const creds = await getDecryptedCredentials("n8n");
  if (!creds?.secrets.apiKey || !creds.config.baseUrl) throw new N8nNotConfiguredError();
  const base = creds.config.baseUrl.replace(/\/+$/, "");
  const res = await fetch(`${base}/api/v1${path}`, {
    ...init,
    headers: { "X-N8N-API-KEY": creds.secrets.apiKey, "Content-Type": "application/json", ...init?.headers },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`n8n API ${res.status}: ${body.slice(0, 300)}`);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export interface N8nWorkflowSummary {
  id: string;
  name: string;
  active: boolean;
  updatedAt: string;
}

export const n8nClient = {
  isReachable: () => n8nRequest<unknown>("/workflows?limit=1").then(() => true).catch(() => false),
  listWorkflows: () => n8nRequest<{ data: N8nWorkflowSummary[] }>("/workflows?limit=250"),
  getWorkflow: (id: string) => n8nRequest<unknown>(`/workflows/${id}`),
  activate: (id: string) => n8nRequest<unknown>(`/workflows/${id}/activate`, { method: "POST" }),
  deactivate: (id: string) => n8nRequest<unknown>(`/workflows/${id}/deactivate`, { method: "POST" }),
  createWorkflow: (workflow: unknown) => n8nRequest<{ id: string }>("/workflows", { method: "POST", body: JSON.stringify(workflow) }),
  listExecutions: (workflowId?: string) =>
    n8nRequest<{ data: unknown[] }>(`/executions?limit=50${workflowId ? `&workflowId=${workflowId}` : ""}`),
  getExecution: (id: string) => n8nRequest<unknown>(`/executions/${id}`),
};
