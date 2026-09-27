/**
 * Same-origin reverse proxy: browser → web (public) → API (private network).
 *
 * The API service therefore needs no public domain at all: the browser only
 * ever talks to this web app, which forwards /api/* to API_INTERNAL_URL
 * (e.g. http://api.railway.internal:4100) at REQUEST time — so the API
 * address is runtime configuration, not baked into the JS bundle, and no
 * NEXT_PUBLIC_* variable is involved. Public callbacks (Telegram webhook,
 * OAuth redirects, signed media links) reach the API through here too.
 */
import { NextRequest } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const HOP_BY_HOP = new Set(["connection", "keep-alive", "proxy-authenticate", "proxy-authorization", "te", "trailer", "transfer-encoding", "upgrade", "host", "content-length"]);

function apiBase(): string {
  return (process.env.API_INTERNAL_URL || "http://localhost:4100").replace(/\/+$/, "");
}

async function proxy(req: NextRequest, ctx: { params: { path: string[] } }): Promise<Response> {
  const target = `${apiBase()}/api/${ctx.params.path.map(encodeURIComponent).join("/")}${req.nextUrl.search}`;
  const headers = new Headers();
  req.headers.forEach((value, key) => {
    if (!HOP_BY_HOP.has(key.toLowerCase())) headers.set(key, value);
  });
  const forwardedFor = req.headers.get("x-forwarded-for");
  if (forwardedFor) headers.set("x-forwarded-for", forwardedFor);
  headers.set("x-forwarded-host", req.headers.get("host") ?? "");
  headers.set("x-forwarded-proto", req.nextUrl.protocol.replace(":", ""));

  const hasBody = !["GET", "HEAD"].includes(req.method);
  let upstream: Response;
  try {
    upstream = await fetch(target, {
      method: req.method,
      headers,
      body: hasBody ? req.body : undefined,
      redirect: "manual",
      cache: "no-store",
      // Required by Node's fetch when streaming a request body.
      ...(hasBody ? { duplex: "half" } : {}),
    } as RequestInit);
  } catch {
    return Response.json({ message: "The Control Center API is not reachable right now. It restarts automatically — try again in a minute." }, { status: 502 });
  }

  const outHeaders = new Headers();
  upstream.headers.forEach((value, key) => {
    if (!HOP_BY_HOP.has(key.toLowerCase()) && key.toLowerCase() !== "content-encoding") outHeaders.set(key, value);
  });
  return new Response(upstream.body, { status: upstream.status, headers: outHeaders });
}

export { proxy as GET, proxy as POST, proxy as PUT, proxy as PATCH, proxy as DELETE };
