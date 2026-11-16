import type { Metadata } from "next";
import { unstable_noStore as noStore } from "next/cache";
import { readPageIdentity } from "@/lib/server-session";
import { loadQuotaSeed } from "@/modules/billing/lib/quota-view";
import PreviewClient from "./PreviewClient";

/**
 * 下書きのプレビュー。ヘッダー直下の編集バーから公開し、告知ページと同じ部品で見た目を確かめる。
 * 未公開の内容を検索に載せない。
 */
export const metadata: Metadata = {
  title: "下書きのプレビュー",
  robots: { index: false, follow: false },
};

// 下書きの内容は毎回 DB から読む。静的な prerender の対象にしない。
export const dynamic = "force-dynamic";

export default async function PreviewPage({ params }: { params: { id: string } }) {
  noStore();
  const identity = await readPageIdentity();
  // 残数はサーバーで読んでおく。読めなかったときだけ、クライアントが取りに行く。
  const initialQuota = await loadQuotaSeed(identity.userId);
  return <PreviewClient params={params} initialQuota={initialQuota} />;
}
