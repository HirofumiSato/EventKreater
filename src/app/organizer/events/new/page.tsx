import { unstable_noStore as noStore } from "next/cache";
import { readPageIdentity } from "@/lib/server-session";
import { loadQuotaSeed } from "@/modules/billing/lib/quota-view";
import { NewEventClient } from "./NewEventClient";

// 身元（Cookie）で残数が変わる。静的な prerender の対象にしない。
export const dynamic = "force-dynamic";

/**
 * 新規イベント作成（SCR-ORG-02）。
 *
 * チケットの残りをサーバーで読んでおく。未ログインは取りに行かず（`signed-out`）、
 * 読めなかったときだけクライアントが取りに行く（`unknown`）。
 * フォーム本体は `useSearchParams` を読むので、Suspense は `NewEventClient` が持つ。
 */
export default async function NewEventPage() {
  noStore();
  const identity = await readPageIdentity();
  const initialQuota = await loadQuotaSeed(identity.userId);
  return <NewEventClient initialQuota={initialQuota} />;
}
