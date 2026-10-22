import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";
import { isUserId } from "@/lib/ids";
import { OrganizerProfileView } from "@/modules/organizers/components/OrganizerProfileView";
import { profileBioExcerpt } from "@/modules/organizers/lib/profile";
import { loadPublicOrganizerProfile } from "@/modules/organizers/lib/profile-store";

/**
 * 主催者の公開プロフィール（SCR-PUB-14）。
 *
 * 参加者が告知ページの主催者名から開くページ。検索結果には出さない。
 * 会員が無い・退会済み・催しが0件のときだけ 404。
 */

export const dynamic = "force-dynamic";

/** metadata と本文で同じ問い合わせを繰り返さないよう、リクエスト内で1回にまとめる。 */
const loadProfile = cache(loadPublicOrganizerProfile);

interface PageProps {
  params: { userId: string };
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  if (!isUserId(params.userId)) {
    return { title: "主催者が見つかりません", robots: { index: false, follow: false } };
  }
  const loaded = await loadProfile(params.userId);
  if (!loaded) {
    return { title: "主催者が見つかりません", robots: { index: false, follow: false } };
  }
  const title = `${loaded.name}さんのプロフィール`;
  const description =
    profileBioExcerpt(loaded.profile.bio, 110) ?? `${loaded.name}さんが主催する催しの日程と会場を確認できます。`;
  return {
    title,
    description,
    robots: { index: false, follow: false },
    openGraph: { title, description, type: "profile" },
  };
}

export default async function OrganizerProfilePage({ params }: PageProps) {
  if (!isUserId(params.userId)) notFound();
  const loaded = await loadProfile(params.userId);
  if (!loaded) notFound();

  return (
    <div className="page--narrow">
      <OrganizerProfileView userId={loaded.userId} name={loaded.name} profile={loaded.profile} />
    </div>
  );
}
