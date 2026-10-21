import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { toErrorResponse } from "@/lib/http";
import { sendFreePeriodEndingNotices } from "@/modules/billing/lib/notices";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function sameSecret(given: string, expected: string): boolean {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * 0円月額の終了前案内を送るバッチ。
 * 外部 cron から、`x-billing-secret` に BILLING_NOTICE_SECRET を付けて1日1回叩く。
 */
export async function POST(req: NextRequest) {
  const secret = process.env.BILLING_NOTICE_SECRET;
  if (!secret) {
    return NextResponse.json(
      {
        error: "NOTICE_JOB_NOT_CONFIGURED",
        detail: "BILLING_NOTICE_SECRET が設定されていません。",
      },
      { status: 503 },
    );
  }

  const header = req.headers.get("x-billing-secret") ?? "";
  const bearer = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!sameSecret(header || bearer, secret)) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }

  try {
    const result = await sendFreePeriodEndingNotices();
    return NextResponse.json(result);
  } catch (error) {
    return toErrorResponse(error, "/api/v1/internal/billing/notices");
  }
}
