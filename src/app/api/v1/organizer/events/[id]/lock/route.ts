import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { generateSecureToken, sha256 } from "@/lib/crypto";
import { ProblemDetailException } from "@/lib/exceptions";
import { assertGuestEditWindow, assertOrganizer } from "@/modules/auth/lib/guards";
import { toErrorResponse } from "@/lib/http";
import { AcquireLockSchema } from "@/lib/schemas";
import { tryAcquireLock } from "@/modules/organizers/lib/locks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: { id: string };
}

async function releaseLock(eventId: string, rawToken: string) {
  const lock = await prisma.eventLock.findUnique({ where: { eventId } });
  if (!lock || lock.lockTokenHash !== sha256(rawToken)) {
    throw new ProblemDetailException({
      status: 409,
      title: "Lock Conflict",
      detail: "このロックを解放する権限がありません。",
      error: "LOCK_MISMATCH",
    });
  }
  await prisma.eventLock.delete({ where: { eventId } });
}

export async function POST(req: NextRequest, { params }: RouteContext) {
  try {
    const ctx = await assertOrganizer(req, params.id);
    const event = await prisma.event.findFirst({
      where: { id: params.id, isDeleted: false },
      select: { id: true, createdAt: true },
    });
    if (!event) {
      throw new ProblemDetailException({
        status: 404,
        title: "Not Found",
        detail: "イベントが見つかりません。",
      });
    }

    const body = AcquireLockSchema.parse(await req.json());
    if (body.release) {
      if (!body.lockToken) {
        throw new ProblemDetailException({
          status: 400,
          title: "Validation Error",
          detail: "ロック解放には lockToken が必要です。",
        });
      }
      await releaseLock(params.id, body.lockToken);
      return NextResponse.json({ success: true, released: true });
    }

    // ロック解放は常に通す。取得だけ猶予を見て、期限切れの未登録幹事を編集画面へ入れない。
    assertGuestEditWindow(ctx, event.createdAt);

    const holderName = body.holderName?.trim();
    if (!holderName) {
      throw new ProblemDetailException({
        status: 400,
        title: "Validation Error",
        detail: "ロック保持者名を入力してください。",
      });
    }

    const rawLockToken = generateSecureToken(32);
    const affected = await tryAcquireLock({
      eventId: params.id,
      userId: ctx.userId,
      guestTokenHash: ctx.userId ? null : ctx.guestTokenHash,
      holderName,
      newLockTokenHash: sha256(rawLockToken),
      currentLockTokenHash: body.currentLockToken ? sha256(body.currentLockToken) : null,
      forceTakeover: body.forceTakeover,
    });

    if (affected === 0) {
      const current = await prisma.eventLock.findUnique({ where: { eventId: params.id } });
      throw new ProblemDetailException({
        status: 409,
        title: "Lock Conflict",
        detail: current
          ? `${current.lockHolderName} が編集中です。`
          : "ロックを取得できませんでした。",
        error: "LOCKED_BY_OTHER",
        holderName: current?.lockHolderName ?? "他の幹事",
      });
    }

    const lock = await prisma.eventLock.findUniqueOrThrow({ where: { eventId: params.id } });
    return NextResponse.json({
      lockToken: rawLockToken,
      holderName: lock.lockHolderName,
    });
  } catch (error) {
    return toErrorResponse(error, `/api/v1/organizer/events/${params.id}/lock`);
  }
}

export async function DELETE(req: NextRequest, { params }: RouteContext) {
  try {
    await assertOrganizer(req, params.id);
    const headerToken = req.headers.get("x-lock-token");
    const urlToken = req.nextUrl.searchParams.get("lockToken");
    let bodyToken: string | null = null;
    if (!headerToken && !urlToken) {
      const text = await req.text();
      if (text) {
        const parsed = JSON.parse(text) as { lockToken?: string };
        bodyToken = parsed.lockToken ?? null;
      }
    }
    const rawToken = headerToken || urlToken || bodyToken;
    if (!rawToken) {
      throw new ProblemDetailException({
        status: 401,
        title: "Unauthorized",
        detail: "ロックトークンが必要です。",
      });
    }
    await releaseLock(params.id, rawToken);
    return NextResponse.json({ success: true });
  } catch (error) {
    return toErrorResponse(error, `/api/v1/organizer/events/${params.id}/lock`);
  }
}
