import { NextRequest, NextResponse } from "next/server";
import { ProblemDetailException } from "@/lib/exceptions";
import { toErrorResponse } from "@/lib/http";
import { loadPublicOrganizerEvents } from "@/modules/organizers/lib/public-organizer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: { userId: string };
}

/**
 * 主催者のイベント（`/organizers/[userId]` の催し一覧）。
 *
 * 誰でも読める（SNS の固定リンクから開けるようにするため）。掲載条件を満たす
 * 催しだけを返し、1件も無くても空の一覧を 200 で返す。
 *
 * 中身は画面と同じ `loadPublicOrganizerEvents` が組む。項目・並び・404 は変えていない。
 * 形の違う ID は、以前は Prisma の uuid 比較で 500 だったが、いまは存在しない ID と
 * 同じ 404 になる（正しい ID の応答は変わらない）。
 */
export async function GET(_req: NextRequest, { params }: RouteContext) {
  try {
    const payload = await loadPublicOrganizerEvents(params.userId);
    if (!payload) {
      throw new ProblemDetailException({
        status: 404,
        title: "Not Found",
        detail: "主催者が見つかりません。",
      });
    }

    return NextResponse.json(payload);
  } catch (error) {
    return toErrorResponse(error, `/api/v1/public/organizers/${params.userId}/events`);
  }
}
