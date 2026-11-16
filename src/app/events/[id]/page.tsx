import type { Metadata } from "next";
import { cache } from "react";
import { cookies } from "next/headers";
import { sha256 } from "@/lib/crypto";
import { readPageIdentity } from "@/lib/server-session";
import { formatDateWithWeekdayJa } from "@/lib/format";
import { PublicThemeShell } from "@/components/common/PublicThemeShell";
import { Alert } from "@/components/ui";
import { rsvpCookieName } from "@/modules/auth/lib/cookies";
import { loadPublicEvent, type PublicEventViewerInput } from "@/modules/events/lib/public-event";
import PublicEventPage from "./EventPageClient";

/**
 * 告知URLは主催者が共有した人だけに届く前提なので、検索エンジンには載せない。
 * SNS のプレビュー用に、イベント名・開催日・場所・チラシ画像を OGP として出す。
 *
 * 誰が見ても同じ部分（本文・題名・チラシ）は `loadPublicEvent` の中でキャッシュし、
 * 人数と自分の回答だけをリクエストごとに引く。本文は HTML に載るので、
 * ハイドレーションを待たずに読める。
 */
export const dynamic = "force-dynamic";

interface PageProps {
  params: { id: string };
}

/**
 * 閲覧者の入力を Cookie から読む。**キャッシュの外**でだけ呼ぶ。
 *
 * ここで読んだ値を `loadPublicEvent` へ渡し、キャッシュ側はイベント ID しか
 * 受け取らない。こうしておくと、共有キャッシュに誰かの回答が混ざらない。
 * 会員とゲスト幹事の見方は `readPageIdentity` に任せ、ここでは出欠の端末だけを足す。
 */
async function readViewer(eventId: string): Promise<PublicEventViewerInput> {
  const identity = await readPageIdentity();
  const rsvpToken = cookies().get(rsvpCookieName(eventId))?.value ?? null;
  return {
    tokenHash: rsvpToken ? sha256(rsvpToken) : null,
    userId: identity.userId,
    guestTokenHashes: identity.guestTokenHashes,
  };
}

/**
 * metadata と本文で同じ問い合わせを繰り返さないよう、リクエスト内で 1 回にまとめる。
 * `themeId` は本文が描く器のテーマと同じ値なので、器と中の見た目は食い違わない。
 */
const loadPageEvent = cache(async (id: string) => loadPublicEvent(id, await readViewer(id)));

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const event = await loadPageEvent(params.id);

  if (!event) {
    return {
      title: "イベントが見つかりません",
      robots: { index: false, follow: false },
    };
  }

  const description = `${formatDateWithWeekdayJa(event.sortDate)} ${event.location}`;
  const image = event.flyerAsset?.imageUrl ?? null;

  return {
    title: event.title,
    description,
    robots: { index: false, follow: false },
    openGraph: {
      title: event.title,
      description,
      type: "website",
      ...(image ? { images: [{ url: image }] } : {}),
    },
    twitter: {
      card: image ? "summary_large_image" : "summary",
      title: event.title,
      description,
      ...(image ? { images: [image] } : {}),
    },
  };
}

export default async function Page({ params }: PageProps) {
  const event = await loadPageEvent(params.id);

  // 見つからないときも器が `<main>` とフッターを持つ（`siteChrome()` はこのパスで
  // `main: false` を返す）。テーマが無ければ器は要素を増やさない。
  if (!event) {
    return (
      <PublicThemeShell themeId={null} flush>
        <Alert tone="error">イベントが見つかりません。</Alert>
      </PublicThemeShell>
    );
  }

  return (
    <PublicThemeShell themeId={event.themeId} flush>
      <PublicEventPage initialEvent={event} />
    </PublicThemeShell>
  );
}
