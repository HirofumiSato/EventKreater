import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ProblemDetailException } from "@/lib/exceptions";

/** 1 つのイベント（保存前は会員・端末）で作れる AI 背景の枚数。 */
export const FLYER_DRAFT_LIMIT = 3;

/** 未ログインで使える通算枚数。cookie の ownerTokenHash で数える。 */
export const FLYER_ANONYMOUS_LIMIT = 1;

export const FLYER_QUOTA_EXCEEDED = "FLYER_QUOTA_EXCEEDED";
export const REGISTER_REQUIRED = "REGISTER_REQUIRED";
export const CANDIDATE_NOT_FOUND = "CANDIDATE_NOT_FOUND";
export const CANDIDATE_ALREADY_SAVED = "CANDIDATE_ALREADY_SAVED";

/**
 * 回数に数える背景の供給元。
 * AI の背景だけが 1 枚 1 回で、`placeholder`（AI の代替）と `upload` は数えない。
 */
export const FLYER_COUNTED_SOURCE = "ai";

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
 * イベントを保存したあとは `eventId` で数え、共同主催者の端末が変わっても枚数を共有する。
 * 保存前はイベント行が無いため、会員は `userId`、未ログインは `ownerTokenHash` に結び付ける。
 * どちらもクライアントが指定できない値なので、下書きを作り直しても枚数は戻らない。
 */
export interface FlyerQuotaScope {
  eventId: string | null;
}

type Db = Prisma.TransactionClient | typeof prisma;

/**
 * 所有者の範囲。イベントの枠と、保存前の会員・端末の枠を分ける。
 * 保存前は `eventId: null` を必ず添え、付け替え済みの行を二重に数えない。
 */
function ownerWhere(
  scope: FlyerQuotaScope,
  owner: FlyerOwner,
): Prisma.FlyerGenerationLogWhereInput {
  if (scope.eventId) return { eventId: scope.eventId };
  if (owner.userId) return { userId: owner.userId, eventId: null };
  return { ownerTokenHash: owner.ownerTokenHash, eventId: null };
}

/** 枚数を数える条件。AI の背景だけを数える。 */
function scopeWhere(
  scope: FlyerQuotaScope,
  owner: FlyerOwner,
): Prisma.FlyerGenerationLogWhereInput {
  return { ...ownerWhere(scope, owner), source: FLYER_COUNTED_SOURCE };
}

function isAnonymous(scope: FlyerQuotaScope, owner: FlyerOwner): boolean {
  // ゲスト幹事も、イベントの枠では未ログイン扱いにしない。
  return !scope.eventId && !owner.userId;
}

/** この単位で使える上限。イベントの枠はログイン有無に関わらず 3 枚。 */
export function flyerQuotaLimit(scope: FlyerQuotaScope, owner: FlyerOwner): number {
  if (scope.eventId || owner.userId) return FLYER_DRAFT_LIMIT;
  return FLYER_ANONYMOUS_LIMIT;
}

/**
 * 残り枚数を返す。保存前は会員・端末に結び付けて数えるので、
 * 新しいイベントを開いても枚数は増えない。
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

function quotaExceeded(scope: FlyerQuotaScope, limit: number): ProblemDetailException {
  return new ProblemDetailException({
    status: 403,
    title: "Quota Exceeded",
    detail: scope.eventId
      ? `このイベントで作れる背景は${limit}枚までです。共同主催・幹事を含めた枚数です。`
      : `作れる背景は${limit}枚までです。イベントを保存すると、次のイベントでは新しく作れます。`,
    error: FLYER_QUOTA_EXCEEDED,
  });
}

function registerRequired(): ProblemDetailException {
  return new ProblemDetailException({
    status: 403,
    title: "Register Required",
    type: "probs/register-required",
    detail: "背景の作成は会員登録後にご利用いただけます。",
    error: REGISTER_REQUIRED,
  });
}

/**
 * AI の背景を作る前の関門。残りが 0 なら、サービスを呼ばずにここで止める。
 * 候補を選び直すだけでは消費しない。
 */
export async function assertFlyerQuota(
  scope: FlyerQuotaScope,
  owner: FlyerOwner,
  db: Db = prisma,
): Promise<FlyerQuota> {
  const quota = await readFlyerQuota(scope, owner, db);
  if (quota.remaining > 0) return quota;
  if (quota.anonymous) throw registerRequired();
  throw quotaExceeded(scope, quota.limit);
}

/** 記録する候補 1 枚。サービスの応答（`source` 付き）をそのまま受け取る。 */
export interface FlyerGenerationCandidate {
  candidateId: string;
  templateId: string;
  layoutId: string;
  paletteId: string;
  source: string;
}

/**
 * 生成した候補を 1 枚 1 行で記録する。`source='ai'` の枚数だけが回数を消費する。
 *
 * 呼び出し側は直列化可能トランザクションで包むこと。ここで書き込む直前に数え直すので、
 * 共同主催者が同時に生成しても上限を超えない（P2034 は呼び出し側で 2 回まで再試行）。
 * 戻り値は記録後の残り枚数で、そのまま応答に使える。
 */
export async function recordFlyerCandidates(
  input: {
    scope: FlyerQuotaScope;
    owner: FlyerOwner;
    candidates: readonly FlyerGenerationCandidate[];
  },
  db: Db = prisma,
): Promise<FlyerQuota> {
  const aiCount = input.candidates.filter(
    (candidate) => candidate.source === FLYER_COUNTED_SOURCE,
  ).length;
  if (aiCount > 0) {
    const quota = await readFlyerQuota(input.scope, input.owner, db);
    if (quota.remaining < aiCount) {
      if (quota.anonymous) throw registerRequired();
      throw quotaExceeded(input.scope, quota.limit);
    }
  }
  if (input.candidates.length > 0) {
    await db.flyerGenerationLog.createMany({
      data: input.candidates.map((candidate) => ({
        candidateId: candidate.candidateId,
        source: candidate.source,
        eventId: input.scope.eventId,
        userId: input.owner.userId,
        ownerTokenHash: input.owner.ownerTokenHash,
        templateId: candidate.templateId,
        layoutId: candidate.layoutId,
        paletteId: candidate.paletteId,
      })),
    });
  }
  return readFlyerQuota(input.scope, input.owner, db);
}

/**
 * 選んだ候補を保存したチラシへ結ぶ。消費はしない（候補を作った時点で消費済み）。
 *
 * `flyerAssetId: null` を条件に 1 行だけ更新するので、同じ候補を二重に保存しようとすると
 * 0 件になり 409 で止まる。`candidateId` は生成履歴にしか無いため、他人の候補は結べない。
 */
export async function attachFlyerAssetToLog(
  input: {
    scope: FlyerQuotaScope;
    owner: FlyerOwner;
    candidateId: string;
    flyerAssetId: string;
  },
  db: Db = prisma,
): Promise<void> {
  const where: Prisma.FlyerGenerationLogWhereInput = {
    ...ownerWhere(input.scope, input.owner),
    candidateId: input.candidateId,
  };
  const updated = await db.flyerGenerationLog.updateMany({
    where: { ...where, flyerAssetId: null },
    data: { flyerAssetId: input.flyerAssetId },
  });
  if (updated.count > 0) return;
  const existing = await db.flyerGenerationLog.count({ where });
  if (existing > 0) {
    throw new ProblemDetailException({
      status: 409,
      title: "Conflict",
      detail: "この背景はすでにチラシとして保存されています。",
      error: CANDIDATE_ALREADY_SAVED,
    });
  }
  throw new ProblemDetailException({
    status: 409,
    title: "Conflict",
    detail: "背景の候補が見つかりません。もう一度背景を作成してください。",
    error: CANDIDATE_NOT_FOUND,
  });
}

/**
 * イベントを保存した時点で、保存前の生成履歴をそのイベントへ付け替える。
 * これをしないと、保存直後の編集で 3 枚を最初から使えてしまう。
 * 端末（未ログイン）の履歴は会員へ引き継がないため、`userId` の行だけを動かす。
 */
export async function attributePendingFlyerLogs(
  userId: string,
  eventId: string,
  db: Db = prisma,
): Promise<number> {
  const result = await db.flyerGenerationLog.updateMany({
    where: { userId, eventId: null },
    data: { eventId },
  });
  return result.count;
}
