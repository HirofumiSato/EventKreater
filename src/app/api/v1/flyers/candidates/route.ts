import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ProblemDetailException } from "@/lib/exceptions";
import { toErrorResponse } from "@/lib/http";
import { ProposeCandidatesSchema } from "@/lib/schemas";
import { proposeBackgroundCandidates } from "@/modules/flyers/lib/flyer";
import {
  assertFlyerQuota,
  recordFlyerCandidates,
  type FlyerGenerationCandidate,
  type FlyerOwner,
  type FlyerQuota,
  type FlyerQuotaScope,
} from "@/modules/flyers/lib/quota";
import { resolveFlyerOwner, writeFlyerOwnerCookie } from "@/modules/flyers/lib/ownership";
import { resolveFlyerQuotaScope } from "@/modules/flyers/lib/scope";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 直列化可能トランザクションの競合。共同主催者の同時生成で上限を超えないために引き直す。 */
function isWriteConflict(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034";
}

/**
 * 候補を記録し、記録後の残り枚数を返す。
 *
 * 直列化可能トランザクションの中で書き込む直前に数え直すので、
 * 共同主催者が同時に生成しても上限を超えない。競合（P2034）は 2 回までやり直す。
 */
async function recordCandidates(
  scope: FlyerQuotaScope,
  owner: FlyerOwner,
  candidates: readonly FlyerGenerationCandidate[],
): Promise<FlyerQuota> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await prisma.$transaction(
        async (tx) => recordFlyerCandidates({ scope, owner, candidates }, tx),
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      if (isWriteConflict(error)) {
        if (attempt < 2) continue;
        throw new ProblemDetailException({
          status: 409,
          title: "Conflict",
          detail: "他の共同主催・幹事と同時に作成されました。もう一度お試しください。",
        });
      }
      throw error;
    }
  }
}

/**
 * ステップ 1。背景タイルを返す。
 * AI の背景を返した時点で 1 枚につき 1 回消費する（選び直しでは消費しない）。
 */
export async function POST(req: NextRequest) {
  try {
    const input = ProposeCandidatesSchema.parse(await req.json());
    const owner = await resolveFlyerOwner(req);
    const scope = await resolveFlyerQuotaScope(req, input.eventId);

    // 残りが 0 なら AI を呼ばずにここで止める。課金も消費も起きない。
    const before = await assertFlyerQuota(scope, owner);
    // 残り枚数を超えてサービスを呼ばない。
    const count = Math.min(input.count ?? 1, before.remaining);
    const { candidates, aiFallback } = await proposeBackgroundCandidates(
      input,
      count,
      owner.ownerTokenHash,
    );

    // サービスが返した供給元で 1 行ずつ記録する。`ai` の行だけが回数を消費する。
    const quota = await recordCandidates(
      scope,
      owner,
      candidates.map((candidate) => ({
        candidateId: candidate.candidateId,
        templateId: candidate.templateId,
        layoutId: candidate.layoutId,
        paletteId: candidate.paletteId,
        source: candidate.source,
      })),
    );

    const response = NextResponse.json({ candidates, aiFallback, quota });
    if (owner.issueCookie) writeFlyerOwnerCookie(response, req, owner.rawToken);
    return response;
  } catch (error) {
    return toErrorResponse(error, "/api/v1/flyers/candidates");
  }
}
