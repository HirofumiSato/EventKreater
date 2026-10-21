import { prisma } from "@/lib/prisma";
import { ProblemDetailException } from "@/lib/exceptions";

/** 1 つの下書き（フォーム）で作れる回数。 */
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
 * 残り回数を返す。未ログインは下書きではなく端末通算で数えるので、
 * 新しいイベントを開いても枠は増えない。
 */
export async function readFlyerQuota(draftKey: string, owner: FlyerOwner): Promise<FlyerQuota> {
  if (!owner.userId) {
    const used = await prisma.flyerGenerationLog.count({
      where: { ownerTokenHash: owner.ownerTokenHash },
    });
    return {
      limit: FLYER_ANONYMOUS_LIMIT,
      used: Math.min(used, FLYER_ANONYMOUS_LIMIT),
      remaining: Math.max(0, FLYER_ANONYMOUS_LIMIT - used),
      anonymous: true,
    };
  }
  const used = await prisma.flyerGenerationLog.count({ where: { draftKey } });
  return {
    limit: FLYER_DRAFT_LIMIT,
    used: Math.min(used, FLYER_DRAFT_LIMIT),
    remaining: Math.max(0, FLYER_DRAFT_LIMIT - used),
    anonymous: false,
  };
}

/**
 * 確定前の関門。候補を選び直すだけでは消費しない。
 * ここを通っても、記録は保存が成功したあとでしか残さない。
 */
export async function assertFlyerQuota(draftKey: string, owner: FlyerOwner): Promise<FlyerQuota> {
  if (!owner.userId) {
    const used = await prisma.flyerGenerationLog.count({
      where: { ownerTokenHash: owner.ownerTokenHash },
    });
    if (used >= FLYER_ANONYMOUS_LIMIT) {
      throw new ProblemDetailException({
        status: 403,
        title: "Register Required",
        type: "probs/register-required",
        detail: "チラシの作成は会員登録後にご利用いただけます。",
        error: REGISTER_REQUIRED,
      });
    }
  }
  const used = await prisma.flyerGenerationLog.count({ where: { draftKey } });
  if (used >= FLYER_DRAFT_LIMIT) {
    throw new ProblemDetailException({
      status: 403,
      title: "Quota Exceeded",
      detail: `このイベントで作れるチラシは${FLYER_DRAFT_LIMIT}回までです。作り直す場合は新しいイベントを開いてください。`,
      error: FLYER_QUOTA_EXCEEDED,
    });
  }
  return readFlyerQuota(draftKey, owner);
}

export async function recordFlyerGeneration(input: {
  draftKey: string;
  owner: FlyerOwner;
  templateId: string;
  layoutId: string;
  paletteId: string;
  flyerAssetId: string;
}): Promise<void> {
  await prisma.flyerGenerationLog.create({
    data: {
      draftKey: input.draftKey,
      userId: input.owner.userId,
      ownerTokenHash: input.owner.ownerTokenHash,
      templateId: input.templateId,
      layoutId: input.layoutId,
      paletteId: input.paletteId,
      flyerAssetId: input.flyerAssetId,
    },
  });
}
