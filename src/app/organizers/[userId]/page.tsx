import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense, cache } from "react";
import { Loading, SemanticThemeScope } from "@/components/ui";
import { isUserId } from "@/lib/ids";
import { OrganizerPageView } from "@/modules/organizers/components/OrganizerPageView";
import { OrganizerProfileView } from "@/modules/organizers/components/OrganizerProfileView";
import { profileBioExcerpt } from "@/modules/organizers/lib/profile";
import { loadPublicOrganizerProfile } from "@/modules/organizers/lib/profile-store";

/**
 * 主催者の公開ページ（SCR-PUB-14）。プロフィールとイベントを1画面に置く。
 *
 * 参加者が告知ページの主催者名から開くページ。検索結果には出さない。
 * プロフィールは誰でも読めるが、カレンダーと一覧は参加者のログインが要る。
 * 会員が無い・退会済み・イベントが0件のときだけ 404。
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
    profileBioExcerpt(loaded.profile.bio, 110) ?? `${loaded.name}さんが主催するイベントの日程と会場を確認できます。`;
  return {
    title,
    description,
    robots: { index: false, follow: false },
    openGraph: {
      title,
      description,
      type: "profile",
      // アイコンは 256px 角。無ければ既定の OGP 画像に任せる。
      ...(loaded.profile.avatarUrl ? { images: [loaded.profile.avatarUrl] } : {}),
    },
  };
}

export default async function OrganizerProfilePage({ params }: PageProps) {
  if (!isUserId(params.userId)) notFound();
  const loaded = await loadProfile(params.userId);
  if (!loaded) notFound();

  return (
    <div className="page--narrow">
      {/* テーマ未選択なら何も包まない（現行の DOM と見た目のまま）。 */}
      <SemanticThemeScope themeId={loaded.profile.themeId} page>
        <div className="stack">
          <OrganizerProfileView name={loaded.name} profile={loaded.profile} />
          {/* イベントは useSearchParams を読むため、Suspense で包む。 */}
          <Suspense
            fallback={
              <Loading>
                読み込んでいます
              </Loading>
            }
          >
            <OrganizerPageView userId={loaded.userId} />
          </Suspense>
        </div>
      </SemanticThemeScope>
    </div>
  );
}
