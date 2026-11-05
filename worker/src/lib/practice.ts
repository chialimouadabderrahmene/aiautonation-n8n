import { prisma } from "./prisma";

// Identical rule lives in api/src/lib/practice.ts — keep them in sync.

/**
 * Practice mode: the real pipeline runs (queue, stages, approval, publish records) but every
 * paid or customer-facing call is simulated. It is how a team learns the product before any
 * key is connected. It is on until someone deliberately goes live; if the flag cannot be read
 * we stay in practice, so a database hiccup can never turn into a real send.
 */
export async function isPracticeMode(): Promise<boolean> {
  try {
    const row = await prisma.setting.findUnique({ where: { key: "practiceMode" } });
    if (row) return row.value === true;
    return process.env.NODE_ENV !== "test";
  } catch {
    return process.env.NODE_ENV !== "test";
  }
}
