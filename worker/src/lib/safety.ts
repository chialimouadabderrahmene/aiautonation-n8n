import { prisma } from "./prisma";

export async function emergencyStopEnabled(): Promise<boolean> {
  const row = await prisma.setting.findUnique({ where: { key: "emergencyStop" }, select: { value: true } });
  return row?.value === true;
}

/** Every outbound delivery must call this at execution time, not only when enqueued. */
export function shouldBlockOutboundJob(emergencyStop: boolean): boolean {
  return emergencyStop;
}
