import { PageHeader, Section, SectionHead, Skeleton } from "@/components/ui";

/**
 * 主催イベント一覧の読み込み中。見出し・絞り込み・一覧の位置を先に決め、
 * 画面全体を回る〇へ置き換えない。
 */
export default function OrganizerEventsLoading() {
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
