import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ProblemDetailException } from "@/lib/exceptions";

/** 1 つのイベント（新規作成中は下書き）で作れる回数。 */
export const FLYER_DRAFT_LIMIT = 3;

/** 未ログインで使える通算回数。cookie の ownerTokenHash で数える。 */
export const FLYER_ANONYMOUS_LIMIT = 1;

export const FLYER_QUOTA_EXCEEDED = "FLYER_QUOTA_EXCEEDED";
export const REGISTER_REQUIRED = "REGISTER_REQUIRED";

export interface FlyerOwner {
  userId: string | null;
  ownerTokenHash: string;
}

export interface FlyerQuota {
  limit: number;
  used: number;
  remaining: number;
  anonymous: boolean;
}

/**
 * 回数を数える単位。
 *
 * 保存済みイベントは `eventId` で数え、共同主催者の端末が変わっても枠を共有する。
 * 公開前の新規作成だけはイベント行が無いため、ブラウザの下書きで数える。
 */
export interface FlyerQuotaScope {
  draftKey: string;
  eventId: string | null;
}

type Db = Prisma.TransactionClient | typeof prisma;

function scopeWhere(
  scope: FlyerQuotaScope,
  owner: FlyerOwner,
): Prisma.FlyerGenerationLogWhereInput {
  if (scope.eventId) return { eventId: scope.eventId };
  // 未ログインは下書きではなく端末通算。ログイン後は下書き単位で数える。
  if (!owner.userId) return { ownerTokenHash: owner.ownerTokenHash };
  // 公開時にイベントへ付け替えるので、公開前の分だけを数える。
  return { draftKey: scope.draftKey, eventId: null };
}

function isAnonymous(scope: FlyerQuotaScope, owner: FlyerOwner): boolean {
  // ゲスト幹事も、イベントの枠では未ログイン扱いにしない。
  return !scope.eventId && !owner.userId;
}

/** この単位で使える上限。イベントの枠はログイン有無に関わらず 3 回。 */
export function flyerQuotaLimit(scope: FlyerQuotaScope, owner: FlyerOwner): number {
  if (scope.eventId || owner.userId) return FLYER_DRAFT_LIMIT;
  return FLYER_ANONYMOUS_LIMIT;
}

/**
 * 残り回数を返す。未ログインは下書きではなく端末通算で数えるので、
 * 新しいイベントを開いても枠は増えない。
 */
export async function readFlyerQuota(
  scope: FlyerQuotaScope,
  owner: FlyerOwner,
  db: Db = prisma,
): Promise<FlyerQuota> {
  const limit = flyerQuotaLimit(scope, owner);
  const used = await db.flyerGenerationLog.count({
    where: scopeWhere(scope, owner),
  });
  return {
    limit,
    used: Math.min(used, limit),
    remaining: Math.max(0, limit - used),
    anonymous: isAnonymous(scope, owner),
  };
}

function exceeded(scope: FlyerQuotaScope, limit: number): ProblemDetailException {
  if (scope.eventId) {
    return new ProblemDetailException({
      status: 403,
      title: "Quota Exceeded",
      detail: `このイベントで作れるチラシは${limit}回までです。共同主催者を含めた回数で、作り直す場合は新しいイベントを作成してください。`,
      error: FLYER_QUOTA_EXCEEDED,
    });
  }
  return new ProblemDetailException({
    status: 403,
    title: "Quota Exceeded",
    detail: `この下書きで作れるチラシは${limit}回までです。新しい下書きで作り直してください。`,
    error: FLYER_QUOTA_EXCEEDED,
  });
}

/**
 * 確定前の関門。候補を選び直すだけでは消費しない。
 * ここを通っても、記録は保存が成功したあとでしか残さない。
 */
export async function assertFlyerQuota(
  scope: FlyerQuotaScope,
  owner: FlyerOwner,
  db: Db = prisma,
): Promise<FlyerQuota> {
  const quota = await readFlyerQuota(scope, owner, db);
  if (quota.remaining > 0) return quota;
  if (quota.anonymous) {
    throw new ProblemDetailException({
      status: 403,
      title: "Register Required",
      type: "probs/register-required",
      detail: "チラシの作成は会員登録後にご利用いただけます。",
      error: REGISTER_REQUIRED,
    });
  }
  throw exceeded(scope, quota.limit);
}

export async function recordFlyerGeneration(
  input: {
    scope: FlyerQuotaScope;
    owner: FlyerOwner;
    templateId: string;
    layoutId: string;
    paletteId: string;
    flyerAssetId: string;
  },
  db: Db = prisma,
): Promise<void> {
  await db.flyerGenerationLog.create({
    data: {
      draftKey: input.scope.draftKey,
      eventId: input.scope.eventId,
      userId: input.owner.userId,
      ownerTokenHash: input.owner.ownerTokenHash,
      templateId: input.templateId,
      layoutId: input.layoutId,
      paletteId: input.paletteId,
      flyerAssetId: input.flyerAssetId,
    },
  });
}

/**
 * 公開されたイベントへ、作成中に使った回数を引き継ぐ。
 * これをしないと、公開直後の編集で 3 回を最初から使えてしまう。
 */
export async function attributeFlyerLogsToEvent(
  draftKey: string,
  eventId: string,
  db: Db = prisma,
): Promise<number> {
  const result = await db.flyerGenerationLog.updateMany({
    where: { draftKey, eventId: null },
    data: { eventId },
  });
  return result.count;
}
