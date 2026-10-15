import { prisma } from "./prisma";

export async function emergencyStopEnabled(): Promise<boolean> {
  const row = await prisma.setting.findUnique({ where: { key: "emergencyStop" }, select: { value: true } });
  return row?.value === true;
}
