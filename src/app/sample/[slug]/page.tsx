import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { SampleEventView } from "../SampleEventView";
import { findSample, SAMPLE_EVENTS } from "../samples";

/**
 * 見本の告知ページ（SCR-PUB-17）。
 *
 * `/events/[id]` と同じ部品で組み、DB を読まない。内容は `samples.ts` の固定データだけなので、
 * ビルド時に全件を書き出せる（`generateStaticParams`）。知らない slug は 404 にする。
 * 見本を検索結果に載せない（本物の告知ページと紛れるため）。
 */
interface PageProps {
  params: { slug: string };
}

export const dynamicParams = false;

export function generateStaticParams(): { slug: string }[] {
  return SAMPLE_EVENTS.map((event) => ({ slug: event.slug }));
}

export function generateMetadata({ params }: PageProps): Metadata {
  const event = findSample(params.slug);
  if (!event) {
    return { title: "サンプルが見つかりません", robots: { index: false, follow: false } };
  }
  return {
    title: `${event.title}（サンプル）`,
    description: `${event.intro} 実際に作った告知ページの見本です。`,
    robots: { index: false, follow: false },
  };
}

export default function SampleEventPage({ params }: PageProps) {
  const event = findSample(params.slug);
  if (!event) notFound();

  return <SampleEventView event={event} />;
}
