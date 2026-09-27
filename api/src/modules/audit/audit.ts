import { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma";

export async function recordAudit(
  actor: string,
  action: string,
  entityType?: string,
  entityId?: string,
  metadata?: Record<string, unknown>,
): Promise<void> {
  // Never pass secret values in `metadata` — this is written to the DB and
  // rendered verbatim in the Activity Logs screen.
  await prisma.auditLog.create({
    data: { actor, action, entityType, entityId, metadata: metadata as Prisma.InputJsonValue | undefined },
  });
}
