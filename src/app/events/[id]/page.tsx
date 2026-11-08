import type { Metadata } from "next";
import { cache } from "react";
import { prisma } from "@/lib/prisma";
import { formatDateWithWeekdayJa } from "@/lib/format";
import { formatEventDate } from "@/lib/serializers";
import { PublicThemeShell } from "@/components/common/PublicThemeShell";
import PublicEventPage from "./EventPageClient";

/**
 * 告知URLは主催者が共有した人だけに届く前提なので、検索エンジンには載せない。
 * SNS のプレビュー用に、イベント名・開催日・場所・チラシ画像を OGP として出す。
 * 画面本体は出欠の再訪照会を持つクライアントコンポーネントに分ける。
 */
export const dynamic = "force-dynamic";

interface PageProps {
  params: { id: string };
}

/**
 * metadata と本文で同じ問い合わせを繰り返さないよう、リクエスト内で 1 回にまとめる。
 * `themeId` は本体が `/api/v1/public/events/[id]` から読む値と同じ `Event.themeId` なので、
 * 器のテーマと中の見た目は食い違わない。
 */
const loadEvent = cache(async (id: string) => {
  return prisma.event.findFirst({
    where: {
      id,
      isDeleted: false,
      status: { in: ["PUBLISHED", "CLOSED"] },
    },
    select: {
      title: true,
      location: true,
      sortDate: true,
      themeId: true,
      flyerAsset: { select: { imageUrl: true, isDeleted: true } },
    },
  });
});

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const event = await loadEvent(params.id);

  if (!event) {
    return {
      title: "イベントが見つかりません",
      robots: { index: false, follow: false },
    };
  }

  const description = `${formatDateWithWeekdayJa(formatEventDate(event.sortDate))} ${event.location}`;
  const image =
    event.flyerAsset && !event.flyerAsset.isDeleted ? event.flyerAsset.imageUrl : null;

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
  const event = await loadEvent(params.id);

  // 見つからないときも器が `<main>` とフッターを持つ（`siteChrome()` はこのパスで
  // `main: false` を返す）。テーマが無ければ器は要素を増やさない。
  return (
    <PublicThemeShell themeId={event?.themeId ?? null} flush>
      <PublicEventPage params={params} />
    </PublicThemeShell>
  );
}
