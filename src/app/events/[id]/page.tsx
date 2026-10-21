import type { Metadata } from "next";
import { prisma } from "@/lib/prisma";
import { formatEventDate } from "@/lib/serializers";
import PublicEventPage from "./EventPageClient";

/**
 * 告知URLは主催者が共有した人だけに届く前提なので、検索エンジンには載せない。
 * SNS のプレビュー用に、催し名・開催日・場所・チラシ画像を OGP として出す。
 * 画面本体は出欠の再訪照会を持つクライアントコンポーネントに分ける。
 */
export const dynamic = "force-dynamic";

interface PageProps {
  params: { id: string };
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const event = await prisma.event.findFirst({
    where: {
      id: params.id,
      isDeleted: false,
      status: { in: ["PUBLISHED", "CLOSED"] },
    },
    select: {
      title: true,
      location: true,
      sortDate: true,
      flyerAsset: { select: { imageUrl: true, isDeleted: true } },
    },
  });

  if (!event) {
    return {
      title: "イベントが見つかりません",
      robots: { index: false, follow: false },
    };
  }

  const description = `${formatEventDate(event.sortDate)} ${event.location}`;
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

export default function Page({ params }: PageProps) {
  return <PublicEventPage params={params} />;
}
