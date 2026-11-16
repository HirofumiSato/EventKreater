import { unstable_noStore as noStore } from "next/cache";
import { readPageIdentity } from "@/lib/server-session";
import { loadQuotaSeed } from "@/modules/billing/lib/quota-view";
import { PlanClient } from "./PlanClient";

// 身元（Cookie）で契約と残数が変わる。静的な prerender の対象にしない。
export const dynamic = "force-dynamic";

/**
 * プラン・カード管理（SCR-ORG-17）。
 *
 * 画面の内容はすべてクォータから決まるので、サーバーで 1 度読んで `PlanClient` へ渡す。
 * 読めなかったときだけクライアントが取り直す（`unknown`）。未ログインは取りに行かない。
 */
export default async function OrganizerPlanPage() {
  noStore();
  const identity = await readPageIdentity();
  const initialQuota = await loadQuotaSeed(identity.userId);
  return <PlanClient initialQuota={initialQuota} />;
}
