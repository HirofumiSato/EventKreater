import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { toErrorResponse } from "@/lib/http";
import { MarkNotificationsSchema } from "@/lib/schemas";
import { requireUserId } from "@/modules/auth/lib/guards";
import { participantsPath } from "@/modules/notifications/lib/rsvp-notification";
import { REFERRAL_NOTIFICATION_HREF } from "@/modules/notifications/lib/referral-notification";
import {
  COHOST_EVENTS_PATH,
  cohostEventPath,
} from "@/modules/notifications/lib/cohost-notification";
import type { NotificationKind } from "@/modules/notifications/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 主催者へのアプリ内通知。参加者の出席・参加要望と、紹介でのチケット付与を返す。
 *
 * 自分の行しか読めない・既読にできない。未読数は札のバッジとメニューが出す。
 * 通知の本文は作成時点の文面をそのまま返す（イベント名を後から変えても過去の通知は動かない）。
 * 行き先は種別で分ける（出欠は名簿、紹介はマイページ）。
 */

const QuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

/** 1 行の行き先。出欠は名簿、紹介はマイページ、共同主催はイベントごとに分ける。 */
function hrefFor(row: { kind: NotificationKind; eventId: string | null }): string {
  // 共同主催から外れた人は編集画面を開けないので、主催一覧へ送る。
  if (row.kind === "COHOST_REMOVED") return COHOST_EVENTS_PATH;
  // 紹介の通知は催しを持たない。催しが無い行も同じくマイページへ送る。
  if (row.kind === "REFERRAL_GRANTED" || row.eventId === null) {
    return REFERRAL_NOTIFICATION_HREF;
  }
  // 受諾の通知は、幹事パネルがある編集画面へ送る。
  if (row.kind === "COHOST_JOINED") return cohostEventPath(row.eventId);
  return participantsPath(row.eventId);
}

/** 1 行を画面の形へ。行き先は種別で分ける（組み立ては `hrefFor` の 1 箇所）。 */
function serialize(row: {
  id: string;
  kind: NotificationKind;
  title: string;
  body: string;
  eventId: string | null;
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
    href: hrefFor(row),
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
