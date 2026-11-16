import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { Loading } from "@/components/ui";
import { isUserId } from "@/lib/ids";
import { OrganizerPageView } from "@/modules/organizers/components/OrganizerPageView";
import { OrganizerProfileView } from "@/modules/organizers/components/OrganizerProfileView";
import { profileBioExcerpt } from "@/modules/organizers/lib/profile";
import { loadPublicOrganizerEvents } from "@/modules/organizers/lib/public-organizer";
import { loadPublicOrganizerProfileCached } from "@/modules/organizers/lib/profile-store";

/**
 * 主催者の公開ページ（SCR-PUB-14）。プロフィールとイベントを1画面に置く。
 *
 * 参加者が告知ページの主催者名から開くページ。検索結果には出さない。
 * プロフィールは誰でも読め、催しも未ログインで見られる。
 * 会員が無い・退会済みのときだけ 404。
 */

export const dynamic = "force-dynamic";

// metadata・本文・器（`layout.tsx`）で同じ問い合わせを繰り返さないよう、
// 読み取りは `profile-store.ts` の `cache()` 済みの 1 本を使う。

interface PageProps {
  params: { userId: string };
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  // 見つからないときは器（`layout.tsx`）が 404 にする。ここは見つかったときの
  // タイトルと OGP だけを持つ（ここで `notFound()` を投げても、骨格
  // `loading.tsx` が先に流れていれば HTTP の状態は 200 のままになる）。
  const loaded = isUserId(params.userId) ? await loadPublicOrganizerProfileCached(params.userId) : null;
  if (!loaded) {
    return { title: "主催者が見つかりません", robots: { index: false, follow: false } };
  }
  const title = `${loaded.name}さんのプロフィール`;
  const description =
    profileBioExcerpt(loaded.profile.bio, 110) ?? `${loaded.name}さんが主催するイベントの日程と会場を確認できます。`;
  // ヘッダー（1920x640）があれば横長を優先する。無ければアイコン（256px 角）。
  const ogImage = loaded.profile.headerUrl ?? loaded.profile.avatarUrl;
  return {
    title,
    description,
    robots: { index: false, follow: false },
    openGraph: {
      title,
      description,
      type: "profile",
      // どちらも無ければ既定の OGP 画像に任せる。
      ...(ogImage ? { images: [ogImage] } : {}),
    },
  };
}

export default async function OrganizerProfilePage({ params }: PageProps) {
  if (!isUserId(params.userId)) notFound();
  // プロフィールと催しは、どちらも本文の描画前に要る。互いに依存しないのでまとめて引く。
  // 催しは `unstable_cache` から返る（人数だけはリクエストごとの集計）。
  const [loaded, listing] = await Promise.all([
    loadPublicOrganizerProfileCached(params.userId),
    loadPublicOrganizerEvents(params.userId),
  ]);
  if (!loaded || !listing) notFound();

  // 読み幅とテーマは器（`layout.tsx`）が持つ。ここは中身だけを並べる。
  return (
    <div className="stack">
      <OrganizerProfileView name={loaded.name} profile={loaded.profile} />
      {/* イベントは useSearchParams を読むため、Suspense で包む。
          催しはサーバーで読んでいるので、ふだんはこの fallback は出ない。 */}
      <Suspense
        fallback={
          <Loading>
            読み込んでいます
          </Loading>
        }
      >
        <OrganizerPageView initialData={listing} />
      </Suspense>
    </div>
  );
}
