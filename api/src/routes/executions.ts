import { Router } from "express";
import { prisma } from "../lib/prisma";

export const executionsRouter = Router();

const STATUSES = ["RUNNING", "SUCCESS", "FAILED", "CANCELLED"] as const;
const SOURCES = ["N8N", "VIDEO_WORKER", "CONTROL_CENTER"] as const;

executionsRouter.get("/", async (req, res) => {
  const { status, source, workflowKey, cursor } = req.query as Record<string, string | undefined>;
  const take = Math.min(200, Math.max(1, Number(req.query.limit ?? 100)));
  const workflow = workflowKey ? await prisma.workflowConfig.findUnique({ where: { key: workflowKey } }) : null;

  const executions = await prisma.automationExecution.findMany({
    where: {
      ...(status && (STATUSES as readonly string[]).includes(status) ? { status: status as (typeof STATUSES)[number] } : {}),
      ...(source && (SOURCES as readonly string[]).includes(source) ? { source: source as (typeof SOURCES)[number] } : {}),
      ...(workflow ? { workflowConfigId: workflow.id } : {}),
    },
    include: { workflowConfig: { select: { key: true, name: true } } },
    orderBy: [{ startedAt: "desc" }, { id: "desc" }],
    take: take + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  });
  const hasMore = executions.length > take;
  const items = executions.slice(0, take);
  res.json({ items, nextCursor: hasMore ? items[items.length - 1]?.id : null });
});

executionsRouter.get("/:id", async (req, res) => {
  const execution = await prisma.automationExecution.findUnique({
    where: { id: String(req.params.id) },
    include: { workflowConfig: { select: { key: true, name: true } } },
  });
  if (!execution) return res.status(404).json({ message: "Not found" });
  res.json(execution);
});
