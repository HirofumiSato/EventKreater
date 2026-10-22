import { NextRequest, NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/http";
import { ProblemDetailException } from "@/lib/exceptions";
import { readFlyerQuota } from "@/modules/flyers/lib/quota";
import { resolveFlyerOwner, writeFlyerOwnerCookie } from "@/modules/flyers/lib/ownership";
import { resolveFlyerQuotaScope } from "@/modules/flyers/lib/scope";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(req: NextRequest) {
  try {
    const draftKey = req.nextUrl.searchParams.get("draftKey") ?? "";
    if (!UUID.test(draftKey)) {
      throw new ProblemDetailException({
        status: 400,
        title: "Validation Error",
        detail: "下書きIDが不正です。",
      });
    }
    const rawEventId = req.nextUrl.searchParams.get("eventId");
    if (rawEventId !== null && rawEventId !== "" && !UUID.test(rawEventId)) {
      throw new ProblemDetailException({
        status: 400,
        title: "Validation Error",
        detail: "イベントIDが不正です。",
      });
    }
    const owner = await resolveFlyerOwner(req);
    const scope = await resolveFlyerQuotaScope(req, draftKey, rawEventId || null);
    const quota = await readFlyerQuota(scope, owner);
    const response = NextResponse.json({ quota });
    if (owner.issueCookie) writeFlyerOwnerCookie(response, req, owner.rawToken);
    return response;
  } catch (error) {
    return toErrorResponse(error, "/api/v1/flyers/quota");
  }
}
