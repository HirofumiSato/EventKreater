import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { ProblemDetailException } from "@/lib/exceptions";
import { assertGuestEditWindow, assertLockHolder, assertOrganizer, assertOwner } from "@/modules/auth/lib/guards";
import { toErrorResponse } from "@/lib/http";
import { UpdateEventSchema } from "@/lib/schemas";
import { serializeEvent, serializeOrganizerList, summarizeStatuses } from "@/lib/serializers";
import {
  assertPricingEditable,
  consumeQuotaForDraftPublish,
  eventOptionsInclude,
  eventUpdateData,
  syncEventOptions,
} from "@/modules/events/lib/events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: { id: string };
}

async function loadManagedEvent(eventId: string) {
  const event = await prisma.event.findFirst({
    where: { id: eventId, isDeleted: false },
    include: {
      flyerAsset: true,
      ...eventOptionsInclude,
      participants: { select: { status: true, pricePlanId: true } },
      organizers: {
        select: {
          id: true,
          role: true,
          userId: true,
          displayName: true,
          user: { select: { name: true } },
        },
        orderBy: { createdAt: "asc" },
      },
      lock: true,
    },
  });
  if (!event) {
    throw new ProblemDetailException({
      status: 404,
      title: "Not Found",
      detail: "イベントが見つかりません。",
    });
  }
  return event;
}

export async function GET(req: NextRequest, { params }: RouteContext) {
  try {
    const ctx = await assertOrganizer(req, params.id);
    const event = await loadManagedEvent(params.id);
    return NextResponse.json({
      event: serializeEvent(event),
      organizers: serializeOrganizerList(event.organizers),
      role: ctx.role,
      // 未登録のゲスト幹事かどうか。公開直後の案内ページが、登録済みの幹事を管理画面へ返すために使う。
      registered: Boolean(ctx.userId),
      stats: summarizeStatuses(event.participants.map((row) => row.status)),
      lock: event.lock ? { holderName: event.lock.lockHolderName } : null,
    });
  } catch (error) {
    return toErrorResponse(error, `/api/v1/organizer/events/${params.id}`);
  }
}

export async function PUT(req: NextRequest, { params }: RouteContext) {
  try {
    const ctx = await assertOrganizer(req, params.id);
    const lockToken = req.headers.get("x-lock-token");
    if (!lockToken) {
      throw new ProblemDetailException({
        status: 409,
        title: "Lock Conflict",
        detail: "更新には有効な排他ロックトークンが必要です。",
        error: "LOCK_REQUIRED",
      });
    }
    await assertLockHolder(params.id, lockToken);
    const existing = await loadManagedEvent(params.id);
    // 未登録の幹事は作成から24時間だけ誤字直しを許す。停止・削除は別ルートなので影響しない。
    assertGuestEditWindow(ctx, existing.createdAt);
    const input = UpdateEventSchema.parse(await req.json());
    assertPricingEditable(existing, input);

    if (input.status && input.status !== existing.status && !(existing.status === "DRAFT" && input.status === "PUBLISHED")) {
      throw new ProblemDetailException({
        status: 400,
        title: "Validation Error",
        detail: "公開状態を変えられるのは、下書きを公開するときだけです。受付を止めるときは主催一覧の「削除・停止」から行います。",
        error: "STATUS_CHANGE_NOT_ALLOWED",
      });
    }

    if (input.capacity && input.capacity > 0) {
      const attending = existing.participants.filter((row) => row.status === "ATTENDING").length;
      if (input.capacity < attending) {
        throw new ProblemDetailException({
          status: 400,
          title: "Validation Error",
          detail: `定員は現在の参加人数（${attending}名）以上にしてください。`,
        });
      }
    }

    const publishingDraft = existing.status === "DRAFT" && input.status === "PUBLISHED";
    if (publishingDraft && (!ctx.userId || ctx.role !== "OWNER")) {
      throw new ProblemDetailException({
        status: 403,
        title: "Forbidden",
        detail: "下書きの公開は筆頭幹事（オーナー）の会員だけが行えます。",
      });
    }

    const event = await prisma.$transaction(async (tx) => {
      // 下書きの公開は、複製で消費済みの枠を二重に引かない。
      const charged = publishingDraft
        ? (await consumeQuotaForDraftPublish(tx, ctx.userId as string, existing.id)).charged
        : false;
      await syncEventOptions(tx, existing.id, input);
      return tx.event.update({
        where: { id: existing.id },
        data: {
          ...eventUpdateData(input),
          ...(input.status ? { status: input.status } : {}),
          ...(charged ? { quotaChargedAt: new Date() } : {}),
        },
        include: { flyerAsset: true, ...eventOptionsInclude },
      });
    });

    return NextResponse.json({ event: serializeEvent(event) });
  } catch (error) {
    return toErrorResponse(error, `/api/v1/organizer/events/${params.id}`);
  }
}

export async function DELETE(req: NextRequest, { params }: RouteContext) {
  try {
    await assertOwner(req, params.id);
    const existing = await loadManagedEvent(params.id);
    await prisma.$transaction([
      prisma.eventLock.deleteMany({ where: { eventId: existing.id } }),
      prisma.event.update({ where: { id: existing.id }, data: { isDeleted: true } }),
    ]);
    return NextResponse.json({ success: true });
  } catch (error) {
    return toErrorResponse(error, `/api/v1/organizer/events/${params.id}`);
  }
}
