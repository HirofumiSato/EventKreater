import { prisma } from "@/lib/prisma";
import { ProblemDetailException } from "@/lib/exceptions";
import type { RateLimitRule } from "@/modules/auth/lib/rate-limits";

const DAY_MS = 24 * 60 * 60 * 1000;

/** 上限の残りと、次に 1 回ぶん空く時刻。 */
export interface AttemptWindow {
  /** 窓の中で許す回数。 */
  limit: number;
  /** 窓の長さ（秒）。 */
  windowSeconds: number;
  /** あと何回できるか。 */
  remainingAttempts: number;
  /** 次に 1 回ぶん空くまでの秒数。 */
  retryAfterSeconds: number;
  /** 次に 1 回ぶん空く時刻（ISO 8601）。 */
  retryAt: string;
}

export function bucketOf(rule: RateLimitRule, key: string): string {
  return `${rule.keyPrefix}${key}`;
}

export async function countAttempts(bucket: string, windowMs: number): Promise<number> {
  return prisma.authAttempt.count({
    where: { bucket, createdAt: { gte: new Date(Date.now() - windowMs) } },
  });
}

export async function clearAttempts(bucket: string): Promise<void> {
  await prisma.authAttempt.deleteMany({ where: { bucket } });
}

/**
 * 窓の中で何回使ったか、次にいつ空くか。
 * 古い行から 1 回ぶんずつ空くため、`retryAt` は一番古い行の時刻に窓を足した値になる。
 */
export async function attemptWindow(rule: RateLimitRule, key: string): Promise<AttemptWindow> {
  const now = Date.now();
  const bucket = bucketOf(rule, key);
  const where = { bucket, createdAt: { gte: new Date(now - rule.windowMs) } };
  const [used, oldest] = await Promise.all([
    prisma.authAttempt.count({ where }),
    prisma.authAttempt.findFirst({
      where,
      orderBy: { createdAt: "asc" },
      select: { createdAt: true },
    }),
  ]);
  const windowSeconds = Math.round(rule.windowMs / 1000);
  const resetAt = (oldest?.createdAt.getTime() ?? now) + rule.windowMs;
  // DB と Node の時計がずれても、Retry-After が窓の長さを超えないようにする。
  const retryAfterSeconds = Math.min(windowSeconds, Math.max(1, Math.ceil((resetAt - now) / 1000)));
  return {
    limit: rule.limit,
    windowSeconds,
    remainingAttempts: Math.max(0, rule.limit - used),
    retryAfterSeconds,
    retryAt: new Date(resetAt).toISOString(),
  };
}

/** 応答本文に載せる上限の情報。429 と失敗応答で同じ形を使う。 */
export function limitExtras(rule: RateLimitRule, state: AttemptWindow): Record<string, unknown> {
  return {
    limitLabel: rule.label,
    attemptLimit: state.limit,
    remainingAttempts: state.remainingAttempts,
    windowSeconds: state.windowSeconds,
    retryAfterSeconds: state.retryAfterSeconds,
    retryAt: state.retryAt,
  };
}

/** 残りが少ないほうの上限を返す。画面には厳しいほうだけを出す。 */
export function tighterLimit(
  pairs: ReadonlyArray<readonly [RateLimitRule, AttemptWindow]>,
): readonly [RateLimitRule, AttemptWindow] | null {
  if (pairs.length === 0) return null;
  return pairs.reduce((best, current) =>
    current[1].remainingAttempts < best[1].remainingAttempts ? current : best,
  );
}

export async function assertWithinAttemptLimit(rule: RateLimitRule, key: string): Promise<void> {
  const state = await attemptWindow(rule, key);
  if (state.remainingAttempts > 0) return;
  throw new ProblemDetailException({
    status: 429,
    title: "Too Many Requests",
    detail: `${rule.label}の回数が上限に達しました。`,
    error: "RATE_LIMITED",
    ...limitExtras(rule, state),
  });
}

/**
 * 古い行を掃除する確率。試行の記録のたびに必ず走らせると、RSVP の共通経路で
 * 索引の効かない全表 DELETE が毎回走る。ごく一部の呼び出しだけに間引く。
 */
const CLEANUP_PROBABILITY = 0.01;
/** 同じプロセスが掃除を続けて起こさないための最短間隔（1 時間）。 */
const CLEANUP_MIN_INTERVAL_MS = 60 * 60 * 1000;
let lastCleanupAt = 0;

/**
 * 1 日より古い行を掃除する。呼んだ側は待たない。
 *
 * 掃除は応答に要らないので、失敗しても握りつぶして警告だけ残す。
 * 窓・上限の数え方は変えない（掃除の有無で試行の判定は変わらない）。
 */
function scheduleAttemptCleanup(): void {
  const now = Date.now();
  if (now - lastCleanupAt < CLEANUP_MIN_INTERVAL_MS) return;
  if (Math.random() >= CLEANUP_PROBABILITY) return;
  lastCleanupAt = now;
  const cutoff = new Date(now - DAY_MS);
  void prisma.authAttempt.deleteMany({ where: { createdAt: { lt: cutoff } } }).catch((error: unknown) => {
    console.warn("[rate-limit] 古い試行の掃除に失敗しました。", error);
  });
}

export async function recordAuthAttempt(rule: RateLimitRule, key: string): Promise<void> {
  await prisma.authAttempt.create({ data: { bucket: bucketOf(rule, key) } });
  scheduleAttemptCleanup();
}

/** 成功したときに、そのバケットの失敗回数を消す。 */
export async function clearRuleAttempts(rule: RateLimitRule, key: string): Promise<void> {
  await clearAttempts(bucketOf(rule, key));
}
