import { z } from "zod";
import { type ConditionNode } from "./conditions";

/**
 * Schema-validated workflow definition — the JSON stored in EngineWorkflowVersion.definition.
 * No code-execution step exists by design (handbook §3.B): a step is either a registered,
 * typed action, a condition branch, a delay, or a parallel fan-out of further steps.
 *
 * Zod schemas below validate untrusted JSON; the plain interfaces are what the rest of the
 * engine actually programs against (kept in sync by hand — safeParse's output is cast to these
 * once, at the validateDefinition() boundary, rather than re-derived via z.infer, so every
 * consumer gets ordinary discriminated-union narrowing instead of zod's weaker inferred types).
 */

export interface ActionStep {
  key: string;
  type: "action";
  action: string;
  input: Record<string, unknown>;
  condition?: ConditionNode;
  onFailure: "fail" | "continue";
  timeoutMs: number;
}
export interface DelayStep {
  key: string;
  type: "delay";
  ms: number;
}
export interface ConditionStep {
  key: string;
  type: "condition";
  condition: ConditionNode;
  onFalse: "skip_remaining" | "continue";
}
export interface ParallelStep {
  key: string;
  type: "parallel";
  branches: StepDefinition[];
  onFailure: "fail" | "continue";
}
export type StepDefinition = ActionStep | DelayStep | ConditionStep | ParallelStep;

export interface WorkflowDefinition {
  description?: string;
  steps: StepDefinition[];
  maxAttempts: number;
}

const operand = z.union([z.string(), z.number(), z.boolean(), z.null()]);

const leafCondition: z.ZodType<unknown> = z.object({
  path: z.string().min(1),
  op: z.enum(["eq", "neq", "gt", "gte", "lt", "lte", "contains", "in", "exists", "matches"]),
  value: z.union([operand, z.array(operand)]).optional(),
});

const conditionNode: z.ZodType<unknown> = z.lazy(() =>
  z.union([
    leafCondition,
    z.object({ all: z.array(conditionNode).min(1) }),
    z.object({ any: z.array(conditionNode).min(1) }),
    z.object({ not: conditionNode }),
  ]),
);

const actionStepSchema = z.object({
  key: z.string().min(1),
  type: z.literal("action"),
  action: z.string().min(1), // must be a key in the action registry — checked at publish time
  input: z.record(z.unknown()).default({}),
  condition: conditionNode.optional(),
  onFailure: z.enum(["fail", "continue"]).default("fail"),
  timeoutMs: z.number().int().positive().max(120_000).default(15_000),
});

const delayStepSchema = z.object({
  key: z.string().min(1),
  type: z.literal("delay"),
  ms: z.number().int().positive().max(1000 * 60 * 60 * 24 * 7), // max 7 days
});

const conditionStepSchema = z.object({
  key: z.string().min(1),
  type: z.literal("condition"),
  condition: conditionNode,
  onFalse: z.enum(["skip_remaining", "continue"]).default("skip_remaining"),
});

// Parallel branches run sequentially within this single-process engine (no distributed step
// fan-out yet) but are modelled explicitly so a future multi-worker executor can parallelise
// them without a definition-format change; each branch's failure policy is independent.
const parallelStepSchema = z.object({
  key: z.string().min(1),
  type: z.literal("parallel"),
  branches: z.array(z.lazy((): z.ZodType<unknown> => stepSchema)).min(1),
  onFailure: z.enum(["fail", "continue"]).default("continue"),
});

const stepSchema: z.ZodType<unknown> = z.union([actionStepSchema, delayStepSchema, conditionStepSchema, parallelStepSchema]);

export const workflowDefinitionSchema = z.object({
  description: z.string().optional(),
  steps: z.array(stepSchema).min(1),
  /** Max total execution attempts before the execution is marked dead-letter. */
  maxAttempts: z.number().int().min(1).max(10).default(3),
});

export function validateDefinition(raw: unknown): { ok: true; definition: WorkflowDefinition } | { ok: false; errors: string[] } {
  const result = workflowDefinitionSchema.safeParse(raw);
  if (!result.success) return { ok: false, errors: result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`) };
  const definition = result.data as unknown as WorkflowDefinition;
  const keys = new Set<string>();
  const dupes: string[] = [];
  const unknownActions: string[] = [];
  const walk = (steps: StepDefinition[]) => {
    for (const s of steps) {
      if (keys.has(s.key)) dupes.push(s.key);
      keys.add(s.key);
      if (s.type === "parallel") walk(s.branches);
    }
  };
  walk(definition.steps);
  if (dupes.length) return { ok: false, errors: [`Duplicate step key(s): ${[...new Set(dupes)].join(", ")}`] };
  return { ok: true, definition };
}

/** Separated from validateDefinition so callers that already imported the action registry
 * (and would otherwise create a require cycle: definition -> actions -> outbox -> queue ->
 * ... -> definition) can run this check only when they need it (publish time). */
export function checkActionReferences(definition: WorkflowDefinition, knownActionKeys: Set<string>): string[] {
  const unknown: string[] = [];
  const walk = (steps: StepDefinition[]) => {
    for (const s of steps) {
      if (s.type === "action" && !knownActionKeys.has(s.action)) unknown.push(`${s.key} -> "${s.action}"`);
      if (s.type === "parallel") walk(s.branches);
    }
  };
  walk(definition.steps);
  return unknown;
}
