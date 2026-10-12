export interface EngineWorkflowSummary {
  id: string;
  key: string;
  name: string;
  description: string | null;
  category: string;
  triggerType: "WEBHOOK" | "EVENT" | "CRON" | "MANUAL";
  triggerConfig: Record<string, unknown>;
  enabled: boolean;
  currentVersionId: string | null;
  currentVersion: { version: number; status: string; publishedAt: string | null } | null;
  _count: { versions: number; executions: number };
  schedule: { nextRunAt: string; lastRunAt: string | null; lastRunOk: boolean | null; enabled: boolean } | null;
  lastExecution: { status: string; startedAt: string; finishedAt: string | null } | null;
}

export interface EngineWorkflowVersion {
  id: string;
  version: number;
  status: "DRAFT" | "PUBLISHED" | "ARCHIVED";
  definition: { steps: unknown[]; maxAttempts?: number };
  notes: string | null;
  createdBy: string;
  createdAt: string;
  publishedAt: string | null;
  publishedBy: string | null;
}

export interface EngineWorkflowDetail extends EngineWorkflowSummary {
  versions: EngineWorkflowVersion[];
}

export interface EngineStepExecution {
  id: string;
  stepKey: string;
  stepIndex: number;
  type: string;
  attempt: number;
  status: "RUNNING" | "SUCCEEDED" | "FAILED" | "SKIPPED";
  input: unknown;
  output: unknown;
  error: string | null;
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
}

export interface EngineExecutionSummary {
  id: string;
  workflowId: string;
  workflow: { key: string; name: string };
  status: "QUEUED" | "RUNNING" | "WAITING" | "RETRYING" | "SUCCEEDED" | "FAILED" | "CANCELLED";
  triggerType: string;
  attempt: number;
  maxAttempts: number;
  deadLetter: boolean;
  error: string | null;
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
  requestedBy: string | null;
  replayOfId: string | null;
}

export interface EngineExecutionDetail extends EngineExecutionSummary {
  version: { version: number };
  triggerPayload: unknown;
  context: unknown;
  correlationId: string;
  idempotencyKey: string;
  steps: EngineStepExecution[];
}

export interface EngineScheduledTrigger {
  id: string;
  cron: string;
  timezone: string;
  nextRunAt: string;
  lastRunAt: string | null;
  lastRunOk: boolean | null;
  enabled: boolean;
  workflow: { key: string; name: string; enabled: boolean };
}

export interface QueueCounts {
  active: number; completed: number; delayed: number; failed: number; paused: number; waiting: number;
}

export interface EngineContentDraft {
  id: string;
  source: string;
  platform: string | null;
  contentType: string | null;
  body: string;
  hashtags: string[];
  status: "DRAFT" | "QUEUED" | "APPROVED" | "REJECTED" | "PUBLISHED";
  reviewNote: string | null;
  createdAt: string;
  reviewedAt: string | null;
  reviewedBy: string | null;
}
