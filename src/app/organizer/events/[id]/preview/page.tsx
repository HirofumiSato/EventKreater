import type { Metadata } from "next";
import PreviewClient from "./PreviewClient";

/**
 * 下書きのプレビュー。告知ページと同じ部品で見た目を確かめ、ここから公開する。
 * 未公開の内容を検索に載せない。
 */
export const metadata: Metadata = {
  title: "下書きのプレビュー",
  robots: { index: false, follow: false },
};

// 下書きの内容は毎回 DB から読む。静的な prerender の対象にしない。
export const dynamic = "force-dynamic";

export default function PreviewPage({ params }: { params: { id: string } }) {
  return <PreviewClient params={params} />;
}
