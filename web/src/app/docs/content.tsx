import { ReactNode } from "react";

export interface DocSection {
  label: string;
  items: { slug: string; title: string; blurb: string }[];
}

export const DOC_NAV: DocSection[] = [
  {
    label: "Getting started",
    items: [
      { slug: "getting-started", title: "Getting Started", blurb: "Log in, connect your first app and activate a workflow." },
      { slug: "architecture", title: "Architecture", blurb: "How web, api, worker, Postgres and Redis fit together." },
    ],
  },
  {
    label: "Core concepts",
    items: [
      { slug: "workflow-engine", title: "Workflow Engine", blurb: "Triggers, actions, retries, scheduling and versioning." },
      { slug: "integrations", title: "Integrations & credentials", blurb: "Connecting and testing a provider safely." },
      { slug: "webhooks", title: "Webhooks", blurb: "Public endpoints, signature verification, idempotency." },
    ],
  },
  {
    label: "Operating it",
    items: [
      { slug: "admin-guide", title: "Running automations", blurb: "Enable, disable, test-run and monitor a workflow." },
      { slug: "api-reference", title: "Admin API reference", blurb: "Every authenticated endpoint this Control Center exposes." },
      { slug: "troubleshooting", title: "Troubleshooting", blurb: "Common failure messages and what they mean." },
    ],
  },
];

export const DOC_FLAT = DOC_NAV.flatMap((s) => s.items);

function H2({ children }: { children: ReactNode }) {
  return <h2 className="mb-3 mt-8 text-lg font-bold text-slate-900 first:mt-0">{children}</h2>;
}
function P({ children }: { children: ReactNode }) {
  return <p className="mb-3 text-sm leading-relaxed text-slate-600">{children}</p>;
}
function Code({ children }: { children: ReactNode }) {
  return <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[13px] text-brand-700">{children}</code>;
}
function Pre({ children }: { children: string }) {
  return <pre className="mb-3 overflow-x-auto rounded-xl bg-slate-900 p-4 text-[13px] leading-relaxed text-slate-100"><code>{children}</code></pre>;
}
function List({ children }: { children: ReactNode }) {
  return <ul className="mb-3 list-disc space-y-1.5 pl-5 text-sm text-slate-600">{children}</ul>;
}
function Note({ children }: { children: ReactNode }) {
  return <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">{children}</div>;
}

export const DOC_CONTENT: Record<string, ReactNode> = {
  "getting-started": (
    <>
      <H2>Your first five minutes</H2>
      <P>
        Sign in with the admin account created when the API first booted (the credentials come from <Code>ADMIN_BOOTSTRAP_EMAIL</Code>/
        <Code>ADMIN_BOOTSTRAP_PASSWORD</Code>, or your operator&apos;s password reset). Change the password in{" "}
        <Code>Settings</Code> after the first login.
      </P>
      <List>
        <li>
          <strong>Connect an app.</strong> Go to <Code>Integrations</Code>, fill in the fields for a provider (e.g. Groq, Telegram,
          WhatsApp Cloud API) and click <Code>Test connection</Code>. A provider only shows <strong>Connected</strong> once its real,
          supported check has actually passed — never because a field is non-empty.
        </li>
        <li>
          <strong>Check readiness.</strong> Open <Code>Automations</Code>. Each of the 22 workflows shows <Code>READY</Code>,
          <Code>BLOCKED</Code> or <Code>ACTION_REQUIRED</Code> with the exact unmet requirement named — click a row to see the full
          checklist.
        </li>
        <li>
          <strong>Activate.</strong> Click <Code>Enable</Code> on a READY workflow, or <Code>Activate ready automations</Code> to turn
          on everything that qualifies at once. A workflow never enables itself — you choose.
        </li>
        <li>
          <strong>Watch it run.</strong> <Code>Executions</Code> shows every run with its status, duration, retries and correlation id.
        </li>
      </List>
      <Note>Nothing here requires n8n. The native workflow engine executes all 22 workflows directly against Postgres and Redis.</Note>
    </>
  ),
  architecture: (
    <>
      <H2>Three services, one database</H2>
      <P>
        <strong>web</strong> is the only public surface — a Next.js app that proxies <Code>/api/*</Code> to the private API at request
        time. <strong>api</strong> owns authentication, the workflow engine, webhooks and scheduling; it is never exposed directly.{" "}
        <strong>worker</strong> is a dedicated BullMQ consumer for the video/content pipeline (FFmpeg, voice, image generation) — it
        takes no inbound traffic.
      </P>
      <P>
        Postgres holds everything: workflow definitions and versions, execution history, leads, content drafts, integrations and the
        audit log. Redis backs two BullMQ queues — trigger matching and execution running — with retries, backoff, dead-lettering and a
        stalled-job recovery sweep.
      </P>
      <H2>No required n8n</H2>
      <P>
        An earlier version of this platform ran workflow logic inside n8n. That logic has since been ported into the native engine
        (<Code>api/src/modules/engine/</Code>) — every one of the 22 workflows executes as TypeScript action handlers against this
        same database, with no n8n process involved in the request path. n8n integration code remains in the repository only as an
        optional, disconnected legacy mirror for operators who still want the original editor side-by-side.
      </P>
    </>
  ),
  "workflow-engine": (
    <>
      <H2>How a workflow runs</H2>
      <P>A workflow definition is versioned JSON made of four step kinds: action, condition, delay, and parallel. Only a PUBLISHED version ever executes.</P>
      <List>
        <li><strong>Trigger.</strong> One of WEBHOOK, EVENT, CRON or MANUAL. A CRON workflow is scheduled by a dependency-free, DST-correct cron evaluator; a WEBHOOK/EVENT one is matched by the trigger-match queue against a typed, Zod-validated event schema.</li>
        <li><strong>Action.</strong> A typed, Zod-validated handler (e.g. <Code>whatsapp.runSequence</Code>, <Code>ai.complete</Code>) — each one is marked idempotent or not, which decides its retry behavior.</li>
        <li><strong>Execution.</strong> Persisted as an <Code>EngineExecution</Code> row with a globally unique idempotency key, a correlation id, per-step history, attempt count and a durable step-output context — a crashed worker resumes from the last committed step instead of losing or repeating work.</li>
        <li><strong>Failure.</strong> Bounded retries with backoff and jitter, a per-step timeout, and a terminal dead-letter state after the max attempt count — dead-lettered executions can be replayed from the Executions screen once the underlying issue is fixed.</li>
      </List>
      <H2>Honest status, never simulated</H2>
      <P>
        An action that depends on an unconfigured provider reports <Code>not_configured</Code> rather than pretending to have sent
        anything. A real provider failure is retried like any other transient error. The platform never marks a message, post or
        publish as delivered without a real provider response confirming it.
      </P>
    </>
  ),
  integrations: (
    <>
      <H2>Connecting a provider</H2>
      <P>
        Open <Code>Integrations</Code>, fill in the required fields for a provider and click <Code>Test connection</Code>. Secret
        fields (API keys, tokens) are encrypted at rest with a key derived from <Code>AUTOMATION_SECRET_KEY</Code> and are masked in
        every response after saving — the raw value is never sent back to the browser, logged, or included in an execution payload.
      </P>
      <List>
        <li>A field left empty never counts as configured — only a real, successful test does.</li>
        <li>A failed test shows the provider&apos;s own error message (redacted of secrets), not a generic failure.</li>
        <li>Rotating a credential is just saving a new value over the old one; the previous value is gone immediately, no soft-delete.</li>
      </List>
      <Note>Never paste a production secret into chat, a commit, or an issue. Enter it only through this page.</Note>
    </>
  ),
  webhooks: (
    <>
      <H2>Inbound webhooks</H2>
      <P>
        Provider webhooks (WhatsApp, Telegram, generic lead-capture, etc.) are received by the <Code>api</Code> service behind the{" "}
        <Code>web</Code> proxy. Each one verifies the request before any business logic runs:
      </P>
      <List>
        <li><strong>WhatsApp</strong> — <Code>X-Hub-Signature-256</Code> HMAC-SHA256 over the raw request body, checked against the configured app secret. An unsigned or mismatched request is rejected with 401 before the payload is ever parsed.</li>
        <li><strong>Telegram</strong> — the bot&apos;s own secret token header, checked on every update.</li>
        <li><strong>Generic lead/referral/waitlist hooks</strong> — an API key header, checked against the value stored in Settings.</li>
      </List>
      <H2>Idempotency</H2>
      <P>
        The same inbound event delivered twice (every provider retries) produces exactly one outbox event and exactly one execution —
        enforced by a unique idempotency key, never by best-effort deduplication.
      </P>
    </>
  ),
  "admin-guide": (
    <>
      <H2>Enable / disable</H2>
      <P>
        A workflow&apos;s <Code>Enable</Code> button is refused with the exact unmet requirement if it isn&apos;t READY. Enabling
        toggles the native engine&apos;s own switch directly — the effect is immediate, no restart or external sync required.
      </P>
      <H2>Test run</H2>
      <P>
        <Code>Test run</Code> queues a real execution of the published version and waits briefly for a result. This runs real actions
        — a connected provider really sends the message, post, or email. Use a disconnected/sandboxed provider while validating a new
        workflow, and only test against real accounts deliberately.
      </P>
      <H2>Emergency stop</H2>
      <P>
        The emergency stop (Settings → Automation safety, <Code>autopilotStop</Code>) refuses every customer-facing send:
        social and video/carousel publishing, WhatsApp messages and email. It is checked when a send is queued and again
        immediately before it leaves the platform. Queued and scheduled publishes are cancelled when it is turned on.
        Team Telegram alerts keep working. Anything that was already inside a provider request when the stop was turned on
        completes, because it had already passed the check. Only an Owner can resume outbound sending.
      </P>
    </>
  ),
  "api-reference": (
    <>
      <H2>Authentication</H2>
      <P>Every endpoint below requires <Code>Authorization: Bearer &lt;token&gt;</Code>, obtained from <Code>POST /api/auth/login</Code>. Tokens are short-lived JWTs; re-authenticate on expiry.</P>
      <Pre>{`curl -X POST https://<your-domain>/api/auth/login \\
  -H "Content-Type: application/json" \\
  -d '{"email":"admin@example.com","password":"..."}'
# → { "token": "..." }`}</Pre>
      <H2>Workflows</H2>
      <List>
        <li><Code>GET /api/workflows</Code> — every workflow, its readiness and current state.</li>
        <li><Code>POST /api/workflows/:key/enable</Code> / <Code>/disable</Code> — the real on/off switch.</li>
        <li><Code>POST /api/workflows/:key/test-run</Code> — queue a real execution and wait for a result.</li>
        <li><Code>POST /api/workflows/activate-ready</Code> — enable every workflow currently READY.</li>
      </List>
      <H2>Engine (advanced)</H2>
      <List>
        <li><Code>GET /api/engine/workflows</Code> / <Code>/:key</Code> — the native engine&apos;s own view, including versions.</li>
        <li><Code>POST /api/engine/workflows/:key/versions</Code> — draft a new definition version.</li>
        <li><Code>POST /api/engine/workflows/:key/versions/:v/publish</Code> — publish a validated draft.</li>
        <li><Code>GET /api/engine/executions</Code> / <Code>/:id</Code> — execution history and per-step detail.</li>
        <li><Code>POST /api/engine/executions/:id/replay</Code> — replay a dead-lettered execution.</li>
      </List>
      <H2>Integrations &amp; system</H2>
      <List>
        <li><Code>GET /api/integrations</Code>, <Code>PUT /api/integrations/:provider</Code>, <Code>POST /api/integrations/:provider/test</Code></li>
        <li><Code>GET /api/system/health</Code> — api/database/redis/worker/storage status.</li>
        <li><Code>GET /api/dashboard</Code> — the aggregate view this Control Center&apos;s Dashboard renders.</li>
        <li><Code>GET /api/audit</Code> — every privileged admin action, immutable.</li>
      </List>
    </>
  ),
  troubleshooting: (
    <>
      <H2>&quot;Not imported into n8n&quot; / n8n-related messages</H2>
      <P>Harmless. n8n is optional legacy infrastructure — enabling, disabling and running a workflow never depend on it. Any n8n status shown is a best-effort mirror only.</P>
      <H2>A workflow stays BLOCKED after connecting a provider</H2>
      <P>Click <Code>Test connection</Code> on that provider&apos;s Integrations card — a saved-but-untested credential never counts as connected. Readiness recomputes automatically right after a successful test.</P>
      <H2>&quot;Execution dead-lettered (max attempts exhausted)&quot;</H2>
      <P>The workflow retried the configured number of times and still failed — open the execution in <Code>Executions</Code> for the real error from the provider, fix the underlying cause (credential, payload, rate limit), then replay it from there.</P>
      <H2>Emergency stop is on and nothing sends</H2>
      <P>Check Settings → Automation safety → <Code>autopilotStop</Code>. This is a deliberate, global kill switch — turn it off to resume outbound sending.</P>
    </>
  ),
};
