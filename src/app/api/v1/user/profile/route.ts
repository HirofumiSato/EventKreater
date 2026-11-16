import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { ProblemDetailException } from "@/lib/exceptions";
import { requireUserId } from "@/modules/auth/lib/guards";
import { toErrorResponse } from "@/lib/http";
import { maskPhone } from "@/modules/auth/lib/login-challenge";
import { requestIpHash, updateDisplayName } from "@/modules/account/lib/account";
import { revalidatePublicOrganizer } from "@/modules/organizers/lib/public-organizer";
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
    // 会員の行と幹事の件数は互いに依存しない。1 ウェーブで引く。
    const [user, organizerCount] = await Promise.all([
      prisma.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          email: true,
          name: true,
          createdAt: true,
          passwordHash: true,
          phoneE164: true,
          phoneVerifiedAt: true,
          // 共通ヘッダーの出し分けに使う。管理者は主催者・参加者とは別の並びにする。
          platformRole: true,
        },
      }),
      // 幹事として 1 件でもイベントを持っているか。ヘッダーの役割切り替えに使う。
      prisma.eventOrganizer.count({
        where: { userId, event: { isDeleted: false } },
      }),
    ]);
    if (!user) {
      throw new ProblemDetailException({
        status: 404,
        title: "Not Found",
        detail: "会員が見つかりません。",
      });
    }

    // 端末だけの出欠・幹事トークンが残っている端末だけ、引き継ぎ（/user/hydrate）を呼ばせる。
    // httpOnly なので画面からは読めない。ここで 1 度だけ確かめて応答に載せる。
    const needsHydrate = req.cookies
      .getAll()
      .some((cookie) => cookie.name.startsWith("rsvp_token_") || cookie.name.startsWith("org_token_"));

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
        // 共通ヘッダーの出し分け用。`MEMBER` / `ADMIN`。
        platformRole: user.platformRole,
      },
      isOrganizer: organizerCount > 0,
      organizerCount,
      /** 端末だけの出欠・幹事を会員へ引き継ぐ必要があるか。 */
      needsHydrate,
    });
  } catch (error) {
    return toErrorResponse(error, "/api/v1/user/profile");
  }
}

/** 表示名の変更。参加者名（participants.name）は過去の記録なので変えない。 */
export async function PATCH(req: NextRequest) {
  try {
    const userId = await requireUserId(req);
    const input = UpdateProfileSchema.parse(await req.json());
    const user = await updateDisplayName({
      userId,
      name: input.name,
      ipHash: requestIpHash(req),
    });
    // 公開ページの催し一覧にも主催者名が入っている。改名を次の閲覧から反映する。
    revalidatePublicOrganizer(userId);
    return NextResponse.json({ user });
  } catch (error) {
    return toErrorResponse(error, "/api/v1/user/profile");
  }
}
