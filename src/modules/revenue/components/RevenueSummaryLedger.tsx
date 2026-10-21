import type { RevenueSummary } from "@/modules/revenue/lib/revenue";

/** 円は「8,000円」で揃える。0 円を「無料」と言い換えない（売上は無料ではない）。 */
function amount(value: number): string {
  return value.toLocaleString("ja-JP");
}

/**
 * 売上サマリ。カードをやめて帳票の行として並べる。
 * 狭い画面は1列。768px 以上では2列にして紙面の横幅を使う。
 * 差額の説明は行に混ぜず、脚注に1回だけ出す。行の高さを揃えるため。
 */
export function RevenueSummaryLedger({ summary }: { summary: RevenueSummary }) {
  return (
    <div>
      <dl className="revenue-ledger">
        <div className="revenue-ledger__row">
          <dt className="revenue-ledger__label">見込み売上</dt>
          <dd className="revenue-ledger__value">
            {amount(summary.expectedRevenue)}
            <span className="revenue-ledger__unit">円</span>
          </dd>
          <dd className="revenue-ledger__note">
            出席 {summary.attendingCount} 人中 {summary.paidAttendingCount} 人がプラン選択済み
          </dd>
        </div>

        <div className="revenue-ledger__row">
          <dt className="revenue-ledger__label">領収書発行額</dt>
          <dd className="revenue-ledger__value">
            {amount(summary.issuedRevenue)}
            <span className="revenue-ledger__unit">円</span>
          </dd>
          <dd className="revenue-ledger__note">{summary.receiptCount} 件を発行済み</dd>
        </div>

        <div className="revenue-ledger__row">
          <dt className="revenue-ledger__label">見込みとの差額</dt>
          <dd
            className={`revenue-ledger__value${
              summary.unreconciled < 0 ? " revenue-ledger__value--warning" : ""
            }`}
          >
            {amount(summary.unreconciled)}
            <span className="revenue-ledger__unit">円</span>
          </dd>
        </div>

        <div className="revenue-ledger__row">
          <dt className="revenue-ledger__label">平均単価</dt>
          <dd className="revenue-ledger__value">
            {amount(summary.averagePerAttendee)}
            <span className="revenue-ledger__unit">円</span>
          </dd>
          <dd className="revenue-ledger__note">プラン選択済みの出席者1人あたり</dd>
        </div>
      </dl>
      <p className="revenue-ledger__foot">
        差額は、見込み売上から領収書発行額を引いたものです。未回収額ではありません。
      </p>
    </div>
  );
}
