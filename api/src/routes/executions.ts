import { Router } from "express";
import { prisma } from "../lib/prisma";

export const executionsRouter = Router();

executionsRouter.get("/", async (req, res) => {
  const { status, source, workflowKey } = req.query as { status?: string; source?: string; workflowKey?: string };
  const workflow = workflowKey ? await prisma.workflowConfig.findUnique({ where: { key: workflowKey } }) : null;

  const executions = await prisma.automationExecution.findMany({
    where: {
      ...(status ? { status: status as "RUNNING" | "SUCCESS" | "FAILED" | "CANCELLED" } : {}),
      ...(source ? { source: source as "N8N" | "VIDEO_WORKER" | "CONTROL_CENTER" } : {}),
      ...(workflow ? { workflowConfigId: workflow.id } : {}),
    },
    include: { workflowConfig: true },
    orderBy: { startedAt: "desc" },
    take: 200,
  });
  res.json(executions);
});

executionsRouter.get("/:id", async (req, res) => {
  const execution = await prisma.automationExecution.findUnique({
    where: { id: req.params.id },
    include: { workflowConfig: true },
  });
  if (!execution) return res.status(404).json({ message: "Not found" });
  res.json(execution);
});
