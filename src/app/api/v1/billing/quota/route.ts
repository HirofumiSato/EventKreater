import { NextRequest, NextResponse } from "next/server";
import { requireUserId } from "@/modules/auth/lib/guards";
import { toErrorResponse } from "@/lib/http";
import { loadQuotaView } from "@/modules/billing/lib/quota-view";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const userId = await requireUserId(req);
    // 数え上げと応答の組み立ては `loadQuotaView` が持つ（画面の初期値と同じ 1 本）。
    const quota = await loadQuotaView(userId);

    return NextResponse.json(quota, {
      // 画面を開くたびに同じ値を取りに行くので、30 秒だけブラウザに持たせる。
      // 応答は会員ごとに違い、共有キャッシュに載せてはいけない（`private`）。
      // 付与・公開の直後に読み直す呼び出しは `useEventQuota` が `cache: "no-store"` で飛ばす。
      headers: { "Cache-Control": "private, max-age=30" },
    });
  } catch (error) {
    return toErrorResponse(error, "/api/v1/billing/quota");
  }
}
