export type IntegrationStatus = "NOT_CONFIGURED" | "CONFIGURED" | "TEST_FAILED" | "CONNECTED" | "ACTION_REQUIRED";
export type AuthType = "API_KEY" | "OAUTH" | "INFRA";
export type FieldType = "secret" | "text" | "url" | "email" | "number" | "select" | "textarea" | "json";

export interface IntegrationField {
  name: string;
  label: string;
  type: FieldType;
  secret: boolean;
  required: boolean;
  placeholder?: string;
  default?: string;
  help?: string;
  options?: { value: string; label: string }[];
  pattern?: string;
  patternMessage?: string;
  group?: string;
  generatable?: boolean;
  maskedPreview: string | null;
}

export interface Integration {
  provider: string;
  key: string;
  label: string;
  category: string;
  authType: AuthType;
  description?: string;
  docsUrl?: string;
  caveat?: string;
  oauth?: { scopes: string[] };
  oauthRedirectUri?: string | null;
  oauthConnected?: boolean;
  status: IntegrationStatus;
  configured: boolean;
  connectedAccount: string | null;
  connectedAt: string | null;
  tokenExpiresAt: string | null;
  lastTestedAt: string | null;
  lastTestOk: boolean | null;
  lastTestMessage: string | null;
  lastTestLatencyMs: number | null;
  updatedAt: string;
  n8nCredentialIds: Record<string, { id: string }>;
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
  n8nPresent: boolean;
  n8nActive: boolean;
  n8nSyncedAt: string | null;
  triggerKind: "manual" | "webhook" | "error";
  lastTestRunAt: string | null;
  lastTestRunOk: boolean | null;
  lastTestRunMessage: string | null;
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

export const ACTIVE_VIDEO_STATES: VideoJobState[] = ["QUEUED", "SCRIPT_GENERATING", "STORYBOARD_READY", "VOICE_GENERATING", "VISUAL_GENERATING", "ASSEMBLING", "QUALITY_CHECK"];

export interface Approval {
  id: string;
  videoJobId: string;
  status: "PENDING" | "APPROVED" | "REJECTED";
  channel: string;
  telegramChatId: string | null;
  note: string | null;
  rejectionReason: string | null;
  decidedAt: string | null;
  decidedBy: string | null;
  createdAt: string;
}

export interface Publication {
  id: string;
  target: string;
  status: "PENDING" | "PUBLISHING" | "PUBLISHED" | "FAILED" | "SKIPPED";
  externalId: string | null;
  externalUrl: string | null;
  error: string | null;
  attempts: number;
  publishedAt: string | null;
}

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
  musicFileId: string | null;
  subtitles: boolean;
  brand: string;
  cta: string | null;
  publishTargets: string[];
  createdAt: string;
  jobs?: (VideoJob & { approval?: Approval | null })[];
}

export interface VideoScene {
  id: string;
  index: number;
  visualPrompt: string;
  voiceoverText: string | null;
  subtitleText: string | null;
  durationSec: number;
  voiceDurationSec: number | null;
  provider: string;
  providerJobId: string | null;
  status: string;
  previewUrl: string | null;
  error: string | null;
}

export interface VideoAsset {
  id: string;
  type: "VOICEOVER" | "SCENE" | "SUBTITLES" | "MUSIC" | "FINAL";
  provider: string | null;
  providerJobId: string | null;
  mimeType: string | null;
  sizeBytes: number | null;
  durationSec: number | null;
  width: number | null;
  height: number | null;
  metadata: Record<string, unknown> | null;
}

export interface VideoJob {
  id: string;
  projectId: string;
  project?: VideoProject;
  state: VideoJobState;
  progress: number;
  script: unknown;
  caption: string | null;
  hashtags: string[];
  error: string | null;
  errorStage: string | null;
  retryCount: number;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  scenes: VideoScene[];
  assets: VideoAsset[];
  approval: Approval | null;
  publications: Publication[];
  finalVideo: {
    playUrl: string | null;
    downloadUrl: string | null;
    durationSec: number | null;
    width: number | null;
    height: number | null;
    sizeBytes: number | null;
    metadata: Record<string, unknown> | null;
  } | null;
}

export interface AutomationExecution {
  id: string;
  source: "N8N" | "VIDEO_WORKER" | "CONTROL_CENTER";
  workflowConfig?: { key: string; name: string } | null;
  externalId: string | null;
  trigger: string | null;
  mode: string | null;
  provider: string | null;
  status: "RUNNING" | "SUCCESS" | "FAILED" | "CANCELLED";
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
  relatedEntityType: string | null;
  relatedEntityId: string | null;
  error: string | null;
  retryCount: number;
}

export type HealthStatus = "ONLINE" | "OFFLINE" | "DEGRADED" | "NOT_CONFIGURED";

export interface ComponentHealth {
  status: HealthStatus;
  message: string;
  checkedAt: string;
  latencyMs?: number;
  lastSeenAt?: string | null;
  details?: Record<string, unknown>;
}

export interface SystemHealth {
  api: ComponentHealth;
  worker: ComponentHealth;
  database: ComponentHealth;
  redis: ComponentHealth;
  n8n: ComponentHealth;
  storage: ComponentHealth;
}

export interface DashboardSummary {
  system: "READY" | "PARTIALLY_READY" | "BLOCKED";
  health: SystemHealth;
  n8nStatus: IntegrationStatus;
  integrations: {
    total: number;
    connected: number;
    notConfigured: number;
    actionRequired: number;
    list: { provider: string; label: string; status: IntegrationStatus; lastTestedAt: string | null }[];
  };
  automations: { total: number; enabled: number; activeInN8n: number; presentInN8n: number; ready: number; blocked: number; actionRequired: number; readyNotEnabled: number };
  video: {
    readiness: Readiness;
    detail: ReadinessDetail[];
    approvalReadiness: Readiness;
    approvalDetail: ReadinessDetail[];
    running: number;
    completed: number;
    failed: number;
    pendingApprovals: number;
  };
  today: { executions: number; successful: number; failed: number; running: number };
  actionRequired: { label: string; detail: string; link: string }[];
  testModeOverrides: string[] | null;
  generatedAt: string;
}

export interface SettingDefinition {
  key: string;
  label: string;
  type: "boolean" | "text" | "url" | "date" | "number" | "select";
  group: string;
  default: string | number | boolean;
  help?: string;
  options?: { value: string; label: string }[];
  n8nEnv?: string;
}

export interface MediaFile {
  id: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
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
