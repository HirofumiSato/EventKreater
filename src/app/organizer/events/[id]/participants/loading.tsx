import { PageHeader, Skeleton } from "@/components/ui";

/**
 * 参加者名簿の読み込み中。見出しと集計帯の位置を先に決め、表だけを待たせる。
 * 画面全体を回る〇へ置き換えない。
 */
export default function ParticipantsLoading() {
  return (
    <div className="stack" aria-busy="true">
      <PageHeader eyebrow="参加者名簿" title={<Skeleton height="1.75rem" width="70%" />} />
      <div className="roster-summary roster-summary--five">
        {["回答", "参加", "参加要望", "欠席", "集金済み"].map((label) => (
          <div className="roster-summary__item" key={label}>
            <span className="roster-summary__label">{label}</span>
            <span className="roster-summary__value">
              <Skeleton height="1.5rem" width="2.5rem" />
            </span>
          </div>
        ))}
      </div>
      <Skeleton height="20rem" shape="card" />
      <p className="visually-hidden" role="status">
        参加者を読み込んでいます
      </p>
    </div>
  );
}
