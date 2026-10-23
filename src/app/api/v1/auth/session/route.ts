import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { readLoginChallengeCookie } from "@/modules/auth/lib/cookies";
import { resolveOptionalUserId } from "@/modules/auth/lib/guards";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 入口ページが「もうログインしているか」を確かめるための軽い照会。
 *
 * Cookie の有無ではなく DB のセッションまで見る。失効済みの Cookie が
 * 残っていても、ここで 401 になるのでフォームを通常どおり出せる。
 * 管理コンソールは `GET /api/v1/admin/session` を使う（役割の判定が違う）。
 *
 * `pendingChallenge` は、確認番号を入力する途中かどうか。セッションが残ったまま
 * 別の会員で入り直す（共用端末）ときは、こちらが真になるので飛ばさない。
 */
export async function GET(req: NextRequest) {
  const userId = await resolveOptionalUserId(req);
  if (!userId) {
    return NextResponse.json({ authenticated: false }, { status: 401 });
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, name: true, phoneVerifiedAt: true, platformRole: true },
  });
  if (!user) {
    return NextResponse.json({ authenticated: false }, { status: 401 });
  }

  const challengeId = readLoginChallengeCookie(req);
  const pendingChallenge = challengeId
    ? await prisma.loginChallenge.findFirst({
        where: { id: challengeId, usedAt: null, expiresAt: { gt: new Date() } },
        select: { id: true },
      })
    : null;

  return NextResponse.json({
    authenticated: true,
    pendingChallenge: Boolean(pendingChallenge),
    user: {
      id: user.id,
      name: user.name,
      phoneVerified: Boolean(user.phoneVerifiedAt),
      platformRole: user.platformRole,
    },
  });
}
