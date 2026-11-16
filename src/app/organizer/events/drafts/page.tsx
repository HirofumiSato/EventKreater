import { unstable_noStore as noStore } from "next/cache";
import { readPageIdentity } from "@/lib/server-session";
import { loadQuotaSeed } from "@/modules/billing/lib/quota-view";
import { DraftsClient } from "./DraftsClient";

// 身元（Cookie）で下書きの枠が変わる。静的な prerender の対象にしない。
export const dynamic = "force-dynamic";

/**
 * 下書き一覧（SCR-ORG-15）。
 *
 * 下書きの件数と上限は `initialQuota` としてサーバーで読む。一覧そのものは
 * `DraftsClient` が今までどおり読む（件数が多く、絞り込みは画面側で行うため）。
 */
export default async function OrganizerDraftsPage() {
  noStore();
  const identity = await readPageIdentity();
  const initialQuota = await loadQuotaSeed(identity.userId);
  return <DraftsClient initialQuota={initialQuota} />;
}
