import { NextRequest, NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/http";
import { ProposeCandidatesSchema } from "@/lib/schemas";
import { proposeTypeCandidates } from "@/modules/flyers/lib/flyer";
import { readFlyerQuota } from "@/modules/flyers/lib/quota";
import { resolveFlyerOwner, writeFlyerOwnerCookie } from "@/modules/flyers/lib/ownership";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const input = ProposeCandidatesSchema.parse(await req.json());
    const owner = await resolveFlyerOwner(req);
    const candidates = await proposeTypeCandidates(input, owner.ownerTokenHash);
    const quota = await readFlyerQuota(input.draftKey, owner);
    const response = NextResponse.json({ candidates, quota });
    if (owner.issueCookie) writeFlyerOwnerCookie(response, req, owner.rawToken);
    return response;
  } catch (error) {
    return toErrorResponse(error, "/api/v1/flyers/candidates/types");
  }
}
