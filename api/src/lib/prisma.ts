import { PrismaClient } from "@prisma/client";

// Single shared client. Standalone database for this project only.
export const prisma = new PrismaClient();
