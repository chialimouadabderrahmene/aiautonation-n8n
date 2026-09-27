export type IntegrationStatus = "NOT_CONFIGURED" | "CONFIGURED" | "TEST_FAILED" | "CONNECTED" | "ACTION_REQUIRED";

export interface IntegrationField {
  name: string;
  label: string;
  secret: boolean;
  required: boolean;
  default?: string;
  maskedPreview: string | null;
}

export interface Integration {
  provider: string;
  label: string;
  category: string;
  description?: string;
  caveat?: string;
  status: IntegrationStatus;
  lastTestedAt: string | null;
  lastTestOk: boolean | null;
  lastTestMessage: string | null;
  lastTestLatencyMs: number | null;
  config: Record<string, string>;
  fields: IntegrationField[];
}

export interface ReadinessDetail {
  requirement: string;
  label: string;
  ok: boolean;
  note?: string;
}

export type Readiness = "READY" | "BLOCKED" | "ACTION_REQUIRED";

export interface WorkflowConfig {
  id: string;
  key: string;
  name: string;
  category: string;
  requiredProviders: string[];
  optionalProviders: string[];
  n8nWorkflowId: string | null;
  enabled: boolean;
  readiness: Readiness;
  readinessDetail: ReadinessDetail[];
  lastExecutionAt: string | null;
  lastExecutionOk: boolean | null;
}

export type VideoJobState =
  | "QUEUED"
  | "SCRIPT_GENERATING"
  | "STORYBOARD_READY"
  | "VOICE_GENERATING"
  | "VISUAL_GENERATING"
  | "ASSEMBLING"
  | "QUALITY_CHECK"
  | "READY"
  | "FAILED"
  | "CANCELLED";

export interface VideoProject {
  id: string;
  name: string;
  contentType: string;
  topic: string;
  prompt: string;
  audience: string | null;
  language: string;
  tone: string;
  durationSec: number;
  aspectRatio: string;
  visualStyle: string;
  voicePreset: string | null;
  music: string;
  subtitles: boolean;
  brand: string;
  cta: string | null;
  createdAt: string;
  jobs?: VideoJob[];
}

export interface VideoScene {
  id: string;
  index: number;
  visualPrompt: string;
  voiceoverText: string | null;
  subtitleText: string | null;
  durationSec: number;
  status: string;
  sceneVideoUrl: string | null;
  error: string | null;
}

export interface VideoAsset {
  id: string;
  type: "VOICEOVER" | "SCENE" | "SUBTITLES" | "MUSIC" | "FINAL";
  provider: string | null;
  url: string;
  durationSec: number | null;
}

export interface Approval {
  id: string;
  status: "PENDING" | "APPROVED" | "REJECTED";
  telegramChatId: string | null;
  decidedAt: string | null;
  decidedBy: string | null;
}

export interface VideoJob {
  id: string;
  projectId: string;
  project?: VideoProject;
  state: VideoJobState;
  script: unknown;
  caption: string | null;
  hashtags: string[];
  finalVideoUrl: string | null;
  error: string | null;
  errorStage: string | null;
  retryCount: number;
  createdAt: string;
  completedAt: string | null;
  scenes: VideoScene[];
  assets: VideoAsset[];
  approval: Approval | null;
}

export interface AutomationExecution {
  id: string;
  source: "N8N" | "VIDEO_WORKER" | "CONTROL_CENTER";
  workflowConfig?: WorkflowConfig | null;
  externalId: string | null;
  trigger: string | null;
  provider: string | null;
  status: "RUNNING" | "SUCCESS" | "FAILED" | "CANCELLED";
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
  error: string | null;
  retryCount: number;
}

export interface DashboardSummary {
  system: "READY" | "PARTIALLY_READY" | "BLOCKED";
  n8nStatus: IntegrationStatus;
  integrations: { total: number; connected: number; actionRequired: number };
  automations: { enabled: number; disabled: number; ready: number; blocked: number };
  video: { running: number; completed: number; failed: number; readiness: Readiness };
  today: { executions: number; successful: number; failed: number };
  actionRequired: { label: string; detail: string }[];
}

export interface AuditLogEntry {
  id: string;
  actor: string;
  action: string;
  entityType: string | null;
  entityId: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}
