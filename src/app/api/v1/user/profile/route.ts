import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { ProblemDetailException } from "@/lib/exceptions";
import { requireUserId } from "@/modules/auth/lib/guards";
import { toErrorResponse } from "@/lib/http";
import { maskPhone } from "@/modules/auth/lib/login-challenge";
import { requestIpHash, updateDisplayName } from "@/modules/account/lib/account";
import { UpdateProfileSchema } from "@/lib/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * ログイン中の会員の基本情報。
 * 参加履歴は /api/v1/user/participations に分離し、この画面（主催者の入口）へ混ぜない。
 */
export async function GET(req: NextRequest) {
  try {
    const userId = await requireUserId(req);
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        name: true,
        createdAt: true,
        passwordHash: true,
        phoneE164: true,
        phoneVerifiedAt: true,
      },
    });
    if (!user) {
      throw new ProblemDetailException({
        status: 404,
        title: "Not Found",
        detail: "会員が見つかりません。",
      });
    }

    // 幹事として 1 件でもイベントを持っているか。ヘッダーの役割切り替えに使う。
    const organizerCount = await prisma.eventOrganizer.count({
      where: { userId, event: { isDeleted: false } },
    });

    return NextResponse.json({
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        createdAt: user.createdAt.toISOString(),
        phoneVerified: Boolean(user.phoneVerifiedAt),
        // 生の番号は返さない。画面には下4桁だけを出す。
        phoneMasked: user.phoneE164 ? maskPhone(user.phoneE164) : null,
        hasPassword: Boolean(user.passwordHash),
      },
      isOrganizer: organizerCount > 0,
      organizerCount,
    });
  } catch (error) {
    return toErrorResponse(error, "/api/v1/user/profile");
  }
}

/** 表示名の変更。参加者名（participants.name）や領収書の宛先は過去の記録なので変えない。 */
export async function PATCH(req: NextRequest) {
  try {
    const userId = await requireUserId(req);
    const input = UpdateProfileSchema.parse(await req.json());
    const user = await updateDisplayName({
      userId,
      name: input.name,
      ipHash: requestIpHash(req),
    });
    return NextResponse.json({ user });
  } catch (error) {
    return toErrorResponse(error, "/api/v1/user/profile");
  }
}
