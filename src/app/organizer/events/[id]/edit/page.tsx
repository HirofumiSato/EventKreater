import { unstable_noStore as noStore } from "next/cache";
import { readPageIdentity } from "@/lib/server-session";
import { loadQuotaSeed } from "@/modules/billing/lib/quota-view";
import { EditEventClient } from "./EditEventClient";

// 身元（Cookie）でチケットの残りが変わる。静的な prerender の対象にしない。
export const dynamic = "force-dynamic";

/**
 * イベント編集（SCR-ORG-05）。
 *
 * チケットの残りをサーバーで読んでおく。下書きを編集する画面なので、帯と
 * 「下書きの枠が空いているか」が最初の HTML に載る。イベント本体は今までどおり
 * クライアントが読む（編集権の確認と同じ往復にまとめるため）。
 */
export default async function EditEventPage({ params }: { params: { id: string } }) {
  noStore();
  const identity = await readPageIdentity();
  const initialQuota = await loadQuotaSeed(identity.userId);
  return <EditEventClient params={params} initialQuota={initialQuota} />;
}
