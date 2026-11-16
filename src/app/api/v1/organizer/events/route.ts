import { NextRequest, NextResponse } from "next/server";
import { collectGuestTokenHashes, resolveUserId } from "@/modules/auth/lib/guards";
import { toErrorResponse } from "@/lib/http";
import { loadOrganizerEvents } from "@/modules/organizers/lib/event-list";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 主催イベントの一覧。読み取りは `loadOrganizerEvents` が持ち、
 * 主催一覧の画面（サーバーコンポーネント）と共有する。
 * 身元が無いときの 401 もローダーが返す。
 */
export async function GET(req: NextRequest) {
  try {
    const userId = await resolveUserId(req);
    const guestTokenHashes = collectGuestTokenHashes(req);
    return NextResponse.json(await loadOrganizerEvents({ userId, guestTokenHashes }));
  } catch (error) {
    return toErrorResponse(error, "/api/v1/organizer/events");
  }
}
