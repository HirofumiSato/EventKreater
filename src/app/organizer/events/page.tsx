import { Suspense } from "react";
import { unstable_noStore as noStore } from "next/cache";
import { PageHeader, Section, SectionHead, Skeleton } from "@/components/ui";
import { ProblemDetailException } from "@/lib/exceptions";
import { readPageIdentity } from "@/lib/server-session";
import { loadQuotaSeed } from "@/modules/billing/lib/quota-view";
import type { OrganizerEvent, QuotaSeed } from "@/modules/events/types";
import { loadOrganizerEvents, splitDraftEvents } from "@/modules/organizers/lib/event-list";
import { OrganizerEventsScreen } from "./OrganizerEventsClient";

export const dynamic = "force-dynamic";

/** 身元が無いときに画面へ出す案内。API の 401 と同じ文にする。 */
const LOGIN_REQUIRED = "ログインするか、幹事用の端末で開いてください。";

/**
 * 主催イベント一覧（SCR-ORG-01）。
 *
 * 一覧はサーバーで読んでクライアントへ渡す。見出し・帯・札が最初の HTML に載り、
 * ハイドレーション後に同じ一覧やチケットの残数を取りに行かない。
 * `useSearchParams` を読むクライアントを包むため、Suspense は残す。
 */
export default async function OrganizerEventsPage() {
  noStore();
  const identity = await readPageIdentity();

  let initialEvents: OrganizerEvent[] = [];
  let initialDraftCount = 0;
  let initialViewer: { userId: string | null; name: string | null } = {
    userId: identity.userId,
    name: null,
  };
  let initialError: string | null = null;
  // チケットの残りも同じウェーブで読む。読めなかったときは今までどおりクライアントで取る。
  let initialQuota: QuotaSeed = identity.userId ? { status: "unknown" } : { status: "signed-out" };

  try {
    const [payload, quota] = await Promise.all([
      loadOrganizerEvents(identity),
      loadQuotaSeed(identity.userId),
    ]);
    const split = splitDraftEvents(payload.events);
    initialEvents = split.events;
    initialDraftCount = split.draftCount;
    initialViewer = payload.viewer;
    initialQuota = quota;
  } catch (cause) {
    initialError =
      cause instanceof ProblemDetailException
        ? cause.status === 401
          ? LOGIN_REQUIRED
          : cause.detail
        : cause instanceof Error
          ? cause.message
          : "読み込みに失敗しました";
  }

  return (
    <Suspense fallback={<OrganizerEventsFallback />}>
      <OrganizerEventsScreen
        initialEvents={initialEvents}
        initialViewer={initialViewer}
        initialDraftCount={initialDraftCount}
        initialError={initialError}
        initialQuota={initialQuota}
      />
    </Suspense>
  );
}

/** Suspense の待ちの間だけ出す骨格。見出しと一覧の位置を先に決める。 */
function OrganizerEventsFallback() {
  return (
    <div className="stack has-action-dock" aria-busy="true">
      <PageHeader title="主催イベント一覧" />
      <Skeleton height="4.5rem" shape="card" />
      <Section className="section--tight">
        <SectionHead title="一覧" />
        <Skeleton height="2.5rem" />
        <div className="event-card-grid">
          <Skeleton height="14rem" shape="card" />
          <Skeleton height="14rem" shape="card" />
        </div>
      </Section>
      <p className="visually-hidden" role="status">
        読み込んでいます
      </p>
    </div>
  );
}
