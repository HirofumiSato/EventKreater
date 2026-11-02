import { prisma } from "@/lib/prisma";
import { isReferralCodeShape } from "@/modules/billing/lib/referral-code";
import { profileContentFromRow } from "@/modules/organizers/lib/profile-store";

/**
 * 紹介リンクの着地ページ（`/invite/<code>`）に出す紹介者。
 *
 * プロフィールの全文は出さない。頭文字かアイコン・名前・肩書き・自己紹介の抜粋だけを
 * 見せ、本文の読み込みは登録後に任せる。公開範囲は公開プロフィールと同じ扱いにする。
 */
export interface ReferralInvite {
  userId: string;
  name: string;
  headline: string | null;
  bio: string | null;
  avatarUrl: string | null;
  themeId: string | null;
}

/**
 * 紹介コードから紹介者を引く。形が違うコード・存在しないコード・退会者は null。
 *
 * 無効でも着地ページは 404 にしない（共有された古いリンクからの流入を落とさない）。
 * その判断は呼び出し側が行い、ここは「引けたか」だけを返す。
 */
export async function loadReferralInvite(code: string): Promise<ReferralInvite | null> {
  const trimmed = code.trim();
  if (!isReferralCodeShape(trimmed)) return null;

  const user = await prisma.user.findFirst({
    where: { referralCode: trimmed, deletedAt: null },
    select: { id: true, name: true, organizerProfile: true },
  });
  if (!user) return null;

  // 非公開のプロフィールは、公開ページと同じく名前とアイコンだけを出す。
  const profile = profileContentFromRow(user.organizerProfile, null);
  return {
    userId: user.id,
    name: user.name,
    headline: profile.headline,
    bio: profile.bio,
    avatarUrl: profile.avatarUrl,
    themeId: profile.themeId,
  };
}
