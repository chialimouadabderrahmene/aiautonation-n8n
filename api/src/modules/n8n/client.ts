import { getDecryptedCredentials } from "../integrations/vault";
import { timedFetch, describeHttpFailure, readErrorDetail, ProviderError } from "../../lib/http";

/**
 * n8n Public API client (verified against n8n 2.40.7's /api/v1 OpenAPI spec:
 * workflows CRUD + activate/deactivate, credentials create/patch/list,
 * executions list). Base URL and API key come from the encrypted vault —
 * normally written there automatically by ./bootstrap.ts.
 */

export class N8nNotConfiguredError extends Error {
  constructor() {
    super("n8n is not connected yet — the deployment connects it automatically; if this persists see Integrations → n8n.");
  }
}

export interface N8nNode {
  id?: string;
  name: string;
  type: string;
  typeVersion: number;
  position: [number, number];
  parameters: Record<string, unknown>;
  credentials?: Record<string, { id: string; name: string }>;
  [k: string]: unknown;
}

export interface N8nWorkflow {
  id: string;
  name: string;
  active: boolean;
  isArchived?: boolean;
  nodes: N8nNode[];
  connections: Record<string, unknown>;
  settings?: Record<string, unknown>;
  updatedAt: string;
}

export interface N8nExecution {
  id: string;
  workflowId: string;
  status: "success" | "error" | "crashed" | "canceled" | "running" | "waiting" | "new" | "unknown";
  mode: string;
  startedAt: string;
  stoppedAt: string | null;
  retryOf?: string | null;
}

export interface N8nConnection {
  baseUrl: string;
  apiKey: string;
  publicUrl?: string;
}

export async function getN8nConnection(): Promise<N8nConnection> {
  const creds = await getDecryptedCredentials("n8n");
  if (!creds?.secrets.apiKey || !creds.config.baseUrl) throw new N8nNotConfiguredError();
  return { baseUrl: creds.config.baseUrl.replace(/\/+$/, ""), apiKey: creds.secrets.apiKey, publicUrl: creds.config.publicUrl };
}

async function n8nRequest<T>(path: string, init: RequestInit = {}, conn?: N8nConnection): Promise<T> {
  const c = conn ?? (await getN8nConnection());
  const { res } = await timedFetch(
    `${c.baseUrl}/api/v1${path}`,
    { ...init, headers: { "X-N8N-API-KEY": c.apiKey, "Content-Type": "application/json", Accept: "application/json", ...init.headers } },
    20_000,
  );
  if (!res.ok) throw describeHttpFailure("n8n", res.status, await readErrorDetail(res));
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

async function listAll<T>(path: string, conn?: N8nConnection): Promise<T[]> {
  const out: T[] = [];
  let cursor: string | null | undefined;
  for (let page = 0; page < 50; page++) {
    const sep = path.includes("?") ? "&" : "?";
    const body = await n8nRequest<{ data: T[]; nextCursor?: string | null }>(`${path}${sep}limit=250${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`, {}, conn);
    out.push(...body.data);
    cursor = body.nextCursor;
    if (!cursor) break;
  }
  return out;
}

export const n8nClient = {
  isReachable: () => n8nRequest<unknown>("/workflows?limit=1").then(() => true).catch(() => false),
  listWorkflows: (conn?: N8nConnection) => listAll<N8nWorkflow>("/workflows", conn),
  getWorkflow: (id: string) => n8nRequest<N8nWorkflow>(`/workflows/${encodeURIComponent(id)}`),
  createWorkflow: (wf: Omit<N8nWorkflow, "id" | "active" | "updatedAt">) => n8nRequest<N8nWorkflow>("/workflows", { method: "POST", body: JSON.stringify(wf) }),
  updateWorkflow: (id: string, wf: Omit<N8nWorkflow, "id" | "active" | "updatedAt">) =>
    n8nRequest<N8nWorkflow>(`/workflows/${encodeURIComponent(id)}`, { method: "PUT", body: JSON.stringify(wf) }),
  activate: (id: string) => n8nRequest<N8nWorkflow>(`/workflows/${encodeURIComponent(id)}/activate`, { method: "POST" }),
  deactivate: (id: string) => n8nRequest<N8nWorkflow>(`/workflows/${encodeURIComponent(id)}/deactivate`, { method: "POST" }),
  listCredentials: () => listAll<{ id: string; name: string; type: string }>("/credentials"),
  createCredential: (name: string, type: string, data: Record<string, unknown>) =>
    n8nRequest<{ id: string; name: string }>("/credentials", { method: "POST", body: JSON.stringify({ name, type, data }) }),
  updateCredential: (id: string, name: string, type: string, data: Record<string, unknown>) =>
    n8nRequest<{ id: string }>(`/credentials/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify({ name, type, data, isPartialData: false }) }),
  listExecutions: (limit = 100) =>
    n8nRequest<{ data: N8nExecution[]; nextCursor?: string | null }>(`/executions?limit=${limit}&includeData=false`).then((r) => r.data),
};

/** Unauthenticated liveness of the n8n process itself (/healthz). */
export async function n8nProcessHealthy(baseUrl: string): Promise<boolean> {
  try {
    const { res } = await timedFetch(`${baseUrl.replace(/\/+$/, "")}/healthz/readiness`, {}, 5000);
    return res.ok;
  } catch {
    return false;
  }
}

export function isNotFound(err: unknown): boolean {
  return err instanceof ProviderError && err.status === 404;
}
