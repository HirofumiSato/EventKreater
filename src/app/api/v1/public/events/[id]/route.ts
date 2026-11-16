import { NextRequest, NextResponse } from "next/server";
import { sha256 } from "@/lib/crypto";
import { ProblemDetailException } from "@/lib/exceptions";
import { toErrorResponse } from "@/lib/http";
import { rsvpCookieName } from "@/modules/auth/lib/cookies";
import { collectGuestTokenHashes, resolveOptionalUserId } from "@/modules/auth/lib/guards";
import { loadPublicEvent } from "@/modules/events/lib/public-event";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: { id: string };
}

/**
 * 公開イベントの取得。告知ページ `/events/[id]` と同じ `loadPublicEvent` を読む。
 *
 * 項目・ステータス・Cookie の扱いは以前のままにする。違うのは 2 点だけで、どちらも
 * ローダー側の既定と合わせるためのもの。
 *
 * - 廃棄したチラシも返す（`includeDeletedFlyer`）。告知ページは出さないが、この API は
 *   以前から返していたので、外部の呼び出しを壊さないよう明示する。
 * - 形の違う ID は 404。以前は Prisma の uuid 比較で例外になり 500 だった。
 *   存在しない ID と同じ扱いになるだけで、正しい ID の応答は変わらない。
 *
 * `dynamic = "force-dynamic"` はそのまま。`unstable_cache` はデータだけを載せるので、
 * 応答ヘッダー（`Cache-Control`）は変わらない。
 */
export async function GET(req: NextRequest, { params }: RouteContext) {
  try {
    // 端末のクッキーは同期で読める。会員の判定だけ非同期。
    const rawToken = req.cookies.get(rsvpCookieName(params.id))?.value;
    const userId = await resolveOptionalUserId(req);

    const event = await loadPublicEvent(
      params.id,
      {
        tokenHash: rawToken ? sha256(rawToken) : null,
        userId,
        // 告知ページの勧誘カードの出し分け。ゲスト幹事は Cookie で本人と分かるので、JWT だけでは足りない。
        guestTokenHashes: collectGuestTokenHashes(req, params.id),
      },
      { includeDeletedFlyer: true },
    );
    if (!event) {
      throw new ProblemDetailException({
        status: 404,
        title: "Not Found",
        detail: "イベントが見つかりません。",
      });
    }

    // ローダーの戻り値は `PublicEvent` そのもの。ここで詰め替えると、項目を足したときに
    // 片方だけ古くなるので、そのまま返す。
    return NextResponse.json(event);
  } catch (error) {
    return toErrorResponse(error, `/api/v1/public/events/${params.id}`);
  }
}
