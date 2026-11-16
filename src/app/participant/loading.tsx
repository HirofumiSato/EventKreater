import { PageHeader, Section, SectionHead, Skeleton } from "@/components/ui";

/**
 * 参加者ホームの読み込み中。呼びかけ・要約の枠を先に描き、催しの中身だけを待たせる。
 * 画面全体を回る〇へ置き換えない。
 */
export default function ParticipantLoading() {
  return (
    <div className="stack" aria-busy="true">
      <PageHeader
        eyebrow="参加者"
        title={<Skeleton height="1.75rem" width="65%" />}
        lead={<Skeleton height="1rem" width="55%" />}
      />
      <div className="roster-summary">
        {["これから", "出席", "欠席", "参加要望"].map((label) => (
          <div className="roster-summary__item" key={label}>
            <span className="roster-summary__label">{label}</span>
            <span className="roster-summary__value">
              <Skeleton height="1.5rem" width="2.5rem" />
            </span>
          </div>
        ))}
      </div>
      <Section style={{ marginTop: 0 }}>
        <SectionHead title="次のイベント" note="いちばん近いものです。" />
        <Skeleton height="12rem" shape="card" />
      </Section>
      <Section>
        <SectionHead title="これからの参加" />
        <Skeleton height="3.5rem" />
        <Skeleton height="3.5rem" />
      </Section>
      <p className="visually-hidden" role="status">
        参加者ホームを読み込んでいます
      </p>
    </div>
  );
}
