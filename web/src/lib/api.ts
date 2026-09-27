/**
 * API client for the Control Center. Standalone from the Eki marketplace's
 * apiClient (admin-web/src/lib/api.ts) — different backend, different token,
 * different storage key. The JWT lives in localStorage the same way the
 * existing Eki admin panel does; it authenticates ONLY against
 * eki-automation-api, never against ekiapp-backend-main.
 */
// Same-origin: /api/* is proxied by this app to the private API (src/app/api/[...path]/route.ts).
const API_BASE_URL = "";
const TOKEN_KEY = "eki_automation_token";

export class APIError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = "APIError";
  }
}

function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

export function hasToken(): boolean {
  return Boolean(getToken());
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getToken();
  const res = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init.headers,
    },
  });

  if (res.status === 401) {
    clearToken();
    if (typeof window !== "undefined" && window.location.pathname !== "/login") {
      window.location.href = "/login";
    }
    throw new APIError(401, "Unauthorized");
  }

  const isJson = res.headers.get("content-type")?.includes("application/json");
  const body = isJson ? await res.json().catch(() => null) : null;

  if (!res.ok) {
    throw new APIError(res.status, body?.message ?? `Request failed (${res.status})`);
  }
  return body as T;
}

export const api = {
  get: <T>(path: string) => request<T>(path, { method: "GET" }),
  post: <T>(path: string, data?: unknown) => request<T>(path, { method: "POST", body: data ? JSON.stringify(data) : undefined }),
  put: <T>(path: string, data?: unknown) => request<T>(path, { method: "PUT", body: data ? JSON.stringify(data) : undefined }),
  delete: <T>(path: string) => request<T>(path, { method: "DELETE" }),
};

export async function login(email: string, password: string): Promise<void> {
  const res = await request<{ token: string }>("/api/auth/login", { method: "POST", body: JSON.stringify({ email, password }) });
  setToken(res.token);
}
