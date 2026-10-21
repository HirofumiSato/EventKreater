import type { RevenueSummary } from "@/modules/revenue/lib/revenue";

/**
 * 円は「8,000円」で揃える。0 円を「無料」と言い換えない（売上は無料ではない）。
 * 負の数は ASCII のハイフンではなく真のマイナス記号（U+2212）にする。桁の幅が揃う。
 */
function amount(value: number): string {
  return value.toLocaleString("ja-JP").replace("-", "\u2212");
}

/**
 * 売上サマリ。カードをやめて帳票の行として並べる。
 * 狭い画面は1列。768px 以上では2列にして紙面の横幅を使う。
 *
 * 注記は短い名詞句に揃える（「参加 4 人」）。説明の文章は行に入れず脚注へ逃がすと、
 * 4 行の高さが揃って罫線のリズムが出る。差額の行だけは、何と何の差かを式で示す。
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
          <dd className="revenue-ledger__note">参加 {summary.attendingCount} 人</dd>
        </div>

        <div className="revenue-ledger__row">
          <dt className="revenue-ledger__label">領収書発行額</dt>
          <dd className="revenue-ledger__value">
            {amount(summary.issuedRevenue)}
            <span className="revenue-ledger__unit">円</span>
          </dd>
          <dd className="revenue-ledger__note">発行 {summary.receiptCount} 件</dd>
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
          {/* 式を出しておくと、差額が何と何の差かを行の中で読み切れる。 */}
          <dd className="revenue-ledger__note">
            見込み {amount(summary.expectedRevenue)} − 発行 {amount(summary.issuedRevenue)}
          </dd>
        </div>

        <div className="revenue-ledger__row">
          <dt className="revenue-ledger__label">平均単価</dt>
          <dd className="revenue-ledger__value">
            {amount(summary.averagePerAttendee)}
            <span className="revenue-ledger__unit">円</span>
          </dd>
          <dd className="revenue-ledger__note">プラン選択済み 1 人あたり</dd>
        </div>
      </dl>
      <p className="revenue-ledger__foot">
        ※差額は、領収書と突き合わせるためのものです。未回収額ではありません。
      </p>
    </div>
  );
}
