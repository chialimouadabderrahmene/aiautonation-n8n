/**
 * Pure condition evaluator. A condition tree is AND/OR groups of typed leaf
 * comparisons over the execution context (dot-path lookup, e.g. "lead.email").
 * No eval(), no arbitrary code — every operator is a fixed, reviewed function.
 */

export type Operand = string | number | boolean | null;

export interface LeafCondition {
  path: string;
  op: "eq" | "neq" | "gt" | "gte" | "lt" | "lte" | "contains" | "in" | "exists" | "matches";
  value?: Operand | Operand[];
}

export interface ConditionGroup {
  all?: ConditionNode[];
  any?: ConditionNode[];
  not?: ConditionNode;
}

export type ConditionNode = LeafCondition | ConditionGroup;

function get(ctx: Record<string, unknown>, path: string): unknown {
  return path.split(".").reduce<unknown>((acc, key) => {
    if (acc === null || acc === undefined || typeof acc !== "object") return undefined;
    // Own properties only — never resolve through the prototype chain (no leaking
    // `constructor`, `__proto__`, inherited methods, etc. into a workflow's output/context).
    if (!Object.prototype.hasOwnProperty.call(acc, key)) return undefined;
    return (acc as Record<string, unknown>)[key];
  }, ctx);
}

function isLeaf(node: ConditionNode): node is LeafCondition {
  return "path" in node && "op" in node;
}

function evalLeaf(ctx: Record<string, unknown>, leaf: LeafCondition): boolean {
  const actual = get(ctx, leaf.path);
  switch (leaf.op) {
    case "exists":
      return actual !== undefined && actual !== null;
    case "eq":
      return actual === leaf.value;
    case "neq":
      return actual !== leaf.value;
    case "gt":
      return typeof actual === "number" && typeof leaf.value === "number" && actual > leaf.value;
    case "gte":
      return typeof actual === "number" && typeof leaf.value === "number" && actual >= leaf.value;
    case "lt":
      return typeof actual === "number" && typeof leaf.value === "number" && actual < leaf.value;
    case "lte":
      return typeof actual === "number" && typeof leaf.value === "number" && actual <= leaf.value;
    case "contains":
      if (typeof actual === "string" && typeof leaf.value === "string") return actual.includes(leaf.value);
      if (Array.isArray(actual)) return actual.includes(leaf.value as never);
      return false;
    case "in":
      return Array.isArray(leaf.value) && (leaf.value as Operand[]).includes(actual as Operand);
    case "matches":
      if (typeof actual !== "string" || typeof leaf.value !== "string") return false;
      try {
        // Bounded, anchored-by-caller patterns only (no user-controlled regex source at runtime —
        // patterns come from a published, admin-authored workflow definition, not request input).
        return new RegExp(leaf.value).test(actual);
      } catch {
        return false;
      }
    default:
      return false;
  }
}

export function evaluateCondition(ctx: Record<string, unknown>, node: ConditionNode | undefined): boolean {
  if (!node) return true;
  if (isLeaf(node)) return evalLeaf(ctx, node);
  if (node.all) return node.all.every((n) => evaluateCondition(ctx, n));
  if (node.any) return node.any.some((n) => evaluateCondition(ctx, n));
  if (node.not) return !evaluateCondition(ctx, node.not);
  return true; // an empty group is vacuously true
}
