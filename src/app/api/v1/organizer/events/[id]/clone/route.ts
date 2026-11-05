import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ProblemDetailException } from "@/lib/exceptions";
import { assertOrganizer } from "@/modules/auth/lib/guards";
import { toErrorResponse } from "@/lib/http";
import {
  formatEventDate,
  formatRsvpDeadlineInput,
  parseEventDate,
  parseRsvpDeadline,
  serializeEvent,
} from "@/lib/serializers";
import { shiftDateByMonths } from "@/modules/events/lib/clone";
import { eventOptionsInclude } from "@/modules/events/lib/events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: { id: string };
}

/** 複製でずらす月数。開催日・申込締切・並び日をそろえて動かす。 */
const CLONE_SHIFT_MONTHS = 1;

/**
 * 申込締切を月単位でずらす。
 *
 * `DateTime`（Timestamptz）のままでは月の計算ができないので、JST の
 * `YYYY-MM-DDTHH:mm` に落として日付の部分だけをずらし、元の時刻のまま戻す。
 * 変換に失敗したときは、元の値のままにする（複製を止めない）。
 */
function shiftRsvpDeadline(value: Date | null, months: number): Date | null {
  if (!value) return null;
  const local = formatRsvpDeadlineInput(value);
  const shifted = parseRsvpDeadline(
    `${shiftDateByMonths(local.slice(0, 10), months)}${local.slice(10)}`,
  );
  return shifted ?? value;
}

export async function POST(req: NextRequest, { params }: RouteContext) {
  try {
    const ctx = await assertOrganizer(req, params.id);
    if (!ctx.userId) {
      throw new ProblemDetailException({
        status: 401,
        title: "Unauthorized",
        detail: "イベントの複製には会員登録が必要です。複製すると筆頭幹事としてチケットを消費します。",
      });
    }
    const userId = ctx.userId;

    const source = await prisma.event.findFirst({
      where: { id: params.id, isDeleted: false },
      include: eventOptionsInclude,
    });
    if (!source) {
      throw new ProblemDetailException({
        status: 404,
        title: "Not Found",
        detail: "コピー元のイベントが見つかりません。",
      });
    }

    if (source.schedules.length === 0 || source.pricePlans.length === 0) {
      throw new ProblemDetailException({
        status: 400,
        title: "Validation Error",
        detail: "コピー元に開催日時または費用プランがありません。",
      });
    }

    const suffix = " (コピー)";
    const title = `${source.title.slice(0, 100 - suffix.length)}${suffix}`;

    try {
      const event = await prisma.$transaction(async (tx) => {
        // 複製は下書きなので、ここではチケットを消費しない。公開（publish）で消費する。
        const created = await tx.event.create({
          data: {
            title,
            // 複製は次の回を作るためのもの。開催日と並び日を1か月後へずらす。
            sortDate: parseEventDate(
              shiftDateByMonths(formatEventDate(source.sortDate), CLONE_SHIFT_MONTHS),
            ),
            location: source.location,
            postalCode: source.postalCode,
            prefecture: source.prefecture,
            city: source.city,
            town: source.town,
            addressLine: source.addressLine,
            building: source.building,
            venueName: source.venueName,
            rainPolicy: source.rainPolicy,
            capacity: source.capacity,
            flyerAssetId: source.flyerAssetId,
            // 一覧を持たないため、複製も常に紹介制で保存する。
            visibility: "UNLISTED",
            // 申込締切も同じ月数だけずらす。時刻は JST のまま保つ。
            rsvpDeadline: shiftRsvpDeadline(source.rsvpDeadline, CLONE_SHIFT_MONTHS),
            status: "DRAFT",
            // 複製は下書き。チケットは公開のときに消費する。
            quotaChargedAt: null,
            schedules: {
              create: source.schedules.map((row) => ({
                eventDate: parseEventDate(
                  shiftDateByMonths(formatEventDate(row.eventDate), CLONE_SHIFT_MONTHS),
                ),
                startTime: row.startTime,
                endTime: row.endTime,
                eventTime: row.eventTime,
                sortOrder: row.sortOrder,
              })),
            },
            pricePlans: {
              create: source.pricePlans.map((row) => ({
                name: row.name,
                audience: row.audience,
                amount: row.amount,
                note: row.note,
                sortOrder: row.sortOrder,
              })),
            },
            // 割引も複製する。参加者の選択は複製しない（別のイベントの出欠なので）。
            discounts: {
              create: source.discounts.map((row) => ({
                name: row.name,
                amount: row.amount,
                note: row.note,
                sortOrder: row.sortOrder,
              })),
            },
          },
          include: { flyerAsset: true, ...eventOptionsInclude },
        });
        await tx.eventOrganizer.create({
          data: {
            eventId: created.id,
            userId,
            role: "OWNER",
          },
        });
        return created;
      });

      return NextResponse.json(
        {
          event: serializeEvent(event),
          // 複製は下書きなので告知ページはまだ無い。
          publicUrl: null,
          manageUrl: `/organizer/events/${event.id}/edit`,
          // 画面が「1か月後へずらした」と案内するために返す。
          shiftedMonths: CLONE_SHIFT_MONTHS,
        },
        { status: 201 },
      );
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new ProblemDetailException({
          status: 409,
          title: "Conflict",
          detail: "複製先の幹事登録が競合しました。再度お試しください。",
        });
      }
      throw error;
    }
  } catch (error) {
    return toErrorResponse(error, `/api/v1/organizer/events/${params.id}/clone`);
  }
}
