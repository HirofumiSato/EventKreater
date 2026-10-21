import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ProblemDetailException } from "@/lib/exceptions";
import { assertOrganizer } from "@/modules/auth/lib/guards";
import { toErrorResponse } from "@/lib/http";
import { consumeEventQuota } from "@/modules/billing/lib/quota";
import { serializeEvent } from "@/lib/serializers";
import { eventOptionsInclude } from "@/modules/events/lib/events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: { id: string };
}

export async function POST(req: NextRequest, { params }: RouteContext) {
  try {
    const ctx = await assertOrganizer(req, params.id);
    if (!ctx.userId) {
      throw new ProblemDetailException({
        status: 401,
        title: "Unauthorized",
        detail: "イベントの複製には会員登録が必要です。複製すると筆頭幹事として利用枠を消費します。",
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
        await consumeEventQuota(tx, userId);
        const created = await tx.event.create({
          data: {
            title,
            sortDate: source.sortDate,
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
            rsvpDeadline: source.rsvpDeadline,
            status: "DRAFT",
            schedules: {
              create: source.schedules.map((row) => ({
                eventDate: row.eventDate,
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
          publicUrl: `/events/${event.id}`,
          manageUrl: `/organizer/events/${event.id}/edit`,
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
