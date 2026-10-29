import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { toErrorResponse } from "@/lib/http";
import { MarkNotificationsSchema } from "@/lib/schemas";
import { requireUserId } from "@/modules/auth/lib/guards";
import { participantsPath } from "@/modules/notifications/lib/rsvp-notification";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 主催者へのアプリ内通知。参加者の出席・参加要望を、名簿を開かなくても気づけるようにする。
 *
 * 自分の行しか読めない・既読にできない。未読数は札のバッジとメニューが出す。
 * 通知の本文は作成時点の文面をそのまま返す（催し名を後から変えても過去の通知は動かない）。
 */

const QuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

/** 1 行を画面の形へ。行き先は `participantsPath` が組み立てる（文面の href と同じ 1 箇所）。 */
function serialize(row: {
  id: string;
  kind: "RSVP_ATTENDING" | "RSVP_WAITLISTED";
  title: string;
  body: string;
  eventId: string;
  participantId: string | null;
  readAt: Date | null;
  createdAt: Date;
}) {
  return {
    id: row.id,
    kind: row.kind,
    title: row.title,
    body: row.body,
    eventId: row.eventId,
    participantId: row.participantId,
    href: participantsPath(row.eventId),
    readAt: row.readAt ? row.readAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function GET(req: NextRequest) {
  try {
    const userId = await requireUserId(req);
    const params = req.nextUrl.searchParams;
    const query = QuerySchema.parse({ limit: params.get("limit") ?? undefined });

    const [rows, unreadCount] = await Promise.all([
      prisma.notification.findMany({
        where: { userId },
        orderBy: { createdAt: "desc" },
        take: query.limit,
      }),
      prisma.notification.count({ where: { userId, readAt: null } }),
    ]);

    return NextResponse.json({
      unreadCount,
      notifications: rows.map(serialize),
    });
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
