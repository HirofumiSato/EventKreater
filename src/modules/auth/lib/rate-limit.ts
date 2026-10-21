import { prisma } from "@/lib/prisma";
import { ProblemDetailException } from "@/lib/exceptions";

const DAY_MS = 24 * 60 * 60 * 1000;

export async function countAttempts(bucket: string, windowMs: number): Promise<number> {
  return prisma.authAttempt.count({
    where: { bucket, createdAt: { gte: new Date(Date.now() - windowMs) } },
  });
}

export async function clearAttempts(bucket: string): Promise<void> {
  await prisma.authAttempt.deleteMany({ where: { bucket } });
}

export async function assertWithinAttemptLimit(bucket: string, limit: number, windowMs: number): Promise<void> {
  const count = await countAttempts(bucket, windowMs);
  if (count >= limit) {
    throw new ProblemDetailException({
      status: 429,
      title: "Too Many Requests",
      detail: "試行回数が多すぎます。しばらく待ってから再度お試しください。",
    });
  }
}

export async function recordAuthAttempt(bucket: string): Promise<void> {
  await prisma.authAttempt.create({ data: { bucket } });
  const recent = await prisma.authAttempt.count({
    where: { bucket, createdAt: { gte: new Date(Date.now() - DAY_MS) } },
  });
  if (recent <= 1) {
    await prisma.authAttempt.deleteMany({
      where: { createdAt: { lt: new Date(Date.now() - DAY_MS) } },
    });
  }
}
