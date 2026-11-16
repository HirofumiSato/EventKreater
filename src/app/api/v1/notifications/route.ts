import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { toErrorResponse } from "@/lib/http";
import { MarkNotificationsSchema } from "@/lib/schemas";
import { requireUserId } from "@/modules/auth/lib/guards";
import { loadNotificationInbox } from "@/modules/notifications/lib/inbox";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 主催者へのアプリ内通知。参加者の出席・参加要望と、紹介でのチケット付与を返す。
 *
 * 自分の行しか読めない・既読にできない。未読数は札のバッジとメニューが出す。
 * 読み取りは `loadNotificationInbox` が持ち、マイページのサーバー描画と共有する。
 */

const QuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export async function GET(req: NextRequest) {
  try {
    const userId = await requireUserId(req);
    const params = req.nextUrl.searchParams;
    const query = QuerySchema.parse({ limit: params.get("limit") ?? undefined });
    return NextResponse.json(await loadNotificationInbox(userId, query.limit));
  } catch (error) {
    return toErrorResponse(error, "/api/v1/notifications");
  }
}

/**
 * 既読にする。`{ all: true }` ですべて、`{ ids: [...] }` で指定した分だけ。
 * 他の会員の ID を混ぜても、`userId` で絞るので何も起きない。
 */
export async function PATCH(req: NextRequest) {
  try {
    const userId = await requireUserId(req);
    const input = MarkNotificationsSchema.parse(await req.json());

    const where = input.all
      ? { userId, readAt: null }
      : { userId, readAt: null, id: { in: input.ids ?? [] } };
    await prisma.notification.updateMany({ where, data: { readAt: new Date() } });

    const unreadCount = await prisma.notification.count({ where: { userId, readAt: null } });
    return NextResponse.json({ unreadCount });
  } catch (error) {
    return toErrorResponse(error, "/api/v1/notifications");
  }
}
