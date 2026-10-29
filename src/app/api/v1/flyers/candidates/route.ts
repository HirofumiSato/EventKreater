import { NextRequest, NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/http";
import { ProposeCandidatesSchema } from "@/lib/schemas";
import { proposeBackgroundCandidates } from "@/modules/flyers/lib/flyer";
import { readFlyerQuota } from "@/modules/flyers/lib/quota";
import { resolveFlyerOwner, writeFlyerOwnerCookie } from "@/modules/flyers/lib/ownership";
import { resolveFlyerQuotaScope } from "@/modules/flyers/lib/scope";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** ステップ 2。背景タイルを返す。ここでは確定のクォータを消費しない。 */
export async function POST(req: NextRequest) {
  try {
    const input = ProposeCandidatesSchema.parse(await req.json());
    const owner = await resolveFlyerOwner(req);
    const scope = await resolveFlyerQuotaScope(req, input.draftKey, input.eventId);
    const { candidates, aiFallback } = await proposeBackgroundCandidates(
      input,
      // 画面は 1 枚ずつ出して作り直させる。AI の課金を 1 回 1 枚に抑える。
      input.count ?? 1,
      owner.ownerTokenHash,
    );
    const quota = await readFlyerQuota(scope, owner);
    const response = NextResponse.json({ candidates, aiFallback, quota });
    if (owner.issueCookie) writeFlyerOwnerCookie(response, req, owner.rawToken);
    return response;
  } catch (error) {
    return toErrorResponse(error, "/api/v1/flyers/candidates");
  }
}
