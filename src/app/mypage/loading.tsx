import { PageHeader, Section, SectionHead, Skeleton } from "@/components/ui";

/**
 * 主催者マイページの読み込み中。見出し・集計帯・直近の催しの枠を先に描き、
 * 中身だけを待たせる。画面全体を回る〇へ置き換えない。
 */
export default function MyPageLoading() {
  return (
    <div className="stack" aria-busy="true">
      <PageHeader
        title="主催者マイページ"
        lead={<Skeleton height="1rem" width="60%" />}
      />
      <div className="roster-summary roster-summary--pairs">
        {["プラン公開", "チケット公開"].map((label) => (
          <div className="roster-summary__item" key={label}>
            <span className="roster-summary__label">{label}</span>
            <span className="roster-summary__value">
              <Skeleton height="1.5rem" width="2.5rem" />
            </span>
          </div>
        ))}
      </div>
      <Skeleton height="4rem" shape="card" />
      <Skeleton height="9rem" shape="card" />
      <Section>
        <SectionHead title="直近のイベント" />
        <Skeleton height="3.5rem" />
        <Skeleton height="3.5rem" />
        <Skeleton height="3.5rem" />
      </Section>
      <p className="visually-hidden" role="status">
        マイページを読み込んでいます
      </p>
    </div>
  );
}
