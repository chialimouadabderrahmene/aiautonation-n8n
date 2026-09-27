import { prisma } from "../../lib/prisma";
import { WORKFLOW_MANIFEST } from "./manifest";

export interface ReadinessDetail {
  requirement: string;
  label: string;
  ok: boolean;
  note?: string;
}

export interface ReadinessResult {
  readiness: "READY" | "BLOCKED" | "ACTION_REQUIRED";
  detail: ReadinessDetail[];
}

async function checkOne(requirement: string): Promise<ReadinessDetail> {
  if (requirement.includes("|")) {
    const options = requirement.split("|");
    const integrations = await prisma.integration.findMany({ where: { provider: { in: options } } });
    const ok = integrations.some((i) => i.status === "CONNECTED");
    return { requirement, label: options.join(" or "), ok, note: ok ? undefined : `None of ${options.join(", ")} is connected` };
  }
  if (requirement.startsWith("setting:")) {
    const key = requirement.slice("setting:".length);
    const setting = await prisma.setting.findUnique({ where: { key } });
    const ok = setting?.value === true;
    return {
      requirement,
      label: humanizeSettingKey(key),
      ok,
      note: ok ? undefined : "Not confirmed in Settings — this cannot be verified automatically",
    };
  }
  const integration = await prisma.integration.findUnique({ where: { provider: requirement } });
  const ok = integration?.status === "CONNECTED";
  return {
    requirement,
    label: requirement,
    ok,
    note: ok ? undefined : `${requirement} is ${integration?.status ?? "NOT_CONFIGURED"}`,
  };
}

function humanizeSettingKey(key: string): string {
  return key.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase());
}

export async function evaluateRequirements(required: string[]): Promise<ReadinessResult> {
  const detail = await Promise.all(required.map(checkOne));
  const failing = detail.filter((d) => !d.ok);
  if (failing.length === 0) return { readiness: "READY", detail };
  // A missing manual/setting confirmation is "action required" (a person needs
  // to confirm something real-world, e.g. Meta template approval); a missing
  // provider connection is a harder "blocked".
  const onlySettings = failing.every((d) => d.requirement.startsWith("setting:"));
  return { readiness: onlySettings ? "ACTION_REQUIRED" : "BLOCKED", detail };
}

/** Re-seeds WorkflowConfig from the manifest (idempotent) and recomputes
 * every workflow's readiness from current integration/setting state. Call
 * after any integration save/test/disconnect, or any settings change. */
export async function recomputeAllReadiness(): Promise<void> {
  for (const entry of WORKFLOW_MANIFEST) {
    await prisma.workflowConfig.upsert({
      where: { key: entry.key },
      update: { name: entry.name, category: entry.category, requiredProviders: entry.required, optionalProviders: entry.optional ?? [] },
      create: {
        key: entry.key,
        name: entry.name,
        category: entry.category,
        requiredProviders: entry.required,
        optionalProviders: entry.optional ?? [],
      },
    });
    const { readiness, detail } = await evaluateRequirements(entry.required);
    await prisma.workflowConfig.update({
      where: { key: entry.key },
      data: { readiness, readinessDetail: detail as unknown as object },
    });
  }
}
