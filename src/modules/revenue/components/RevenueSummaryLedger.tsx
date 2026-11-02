import type { RevenueSummary } from "@/modules/revenue/lib/revenue";

/**
 * 円は「8,000円」で揃える。0 円を「無料」と言い換えない（売上は無料ではない）。
 * 負の数は ASCII のハイフンではなく真のマイナス記号（U+2212）にする。桁の幅が揃う。
 */
function amount(value: number): string {
  return value.toLocaleString("ja-JP").replace("-", "\u2212");
}

/** 省略できる行。既定はどれも出す（売上の内訳・全体の 2 画面はこのまま使う）。 */
export type LedgerRowKey = "collected" | "difference";

/**
 * 売上サマリ。カードをやめて帳票の行として並べる。
 * 狭い画面は1列。768px 以上では2列にして紙面の横幅を使う。
 *
 * 注記は短い名詞句に揃える（「参加 4 人」）。説明の文章は行に入れず脚注へ逃がす。
 * 未集金の行は、ラベルと金額だけで意味が通るので注記を持たない。
 */
export function RevenueSummaryLedger({
  summary,
  myShare,
  omit = [],
  dense = false,
}: {
  summary: RevenueSummary;
  /** 按分後の自分の見込み取り分。渡されたときだけ行を足す。 */
  myShare?: { expectedRevenue: number };
  /** 描かない行。名簿の上では未集金まで見せず、見込みと平均だけに絞る。 */
  omit?: readonly LedgerRowKey[];
  /** 行の間隔と字を詰める。名簿の下へ押し下げないため。 */
  dense?: boolean;
}) {
  const hidden = new Set<LedgerRowKey>(omit);
  return (
    <div className={`ledger-block${dense ? " ledger-block--compact" : ""}`}>
      <dl className="ledger">
        <div className="ledger__row">
          <dt className="ledger__label">
            見込み売上
            <span className="ledger__note">参加 {summary.attendingCount} 人</span>
          </dt>
          <dd className="ledger__value">
            {amount(summary.expectedRevenue)}
            <span className="ledger__note">円</span>
          </dd>
        </div>

        {!hidden.has("collected") && (
          <div className="ledger__row">
            <dt className="ledger__label">
              集金済み
              <span className="ledger__note">集金 {summary.collectedCount} 人</span>
            </dt>
            <dd className="ledger__value">
              {amount(summary.collectedRevenue)}
              <span className="ledger__note">円</span>
            </dd>
          </div>
        )}

        {!hidden.has("difference") && (
          <div className="ledger__row ledger__row--total">
            <dt className="ledger__label">未集金</dt>
            <dd
              className={`ledger__value${
                summary.uncollected < 0 ? " ledger__value--warning" : ""
              }`}
            >
              {amount(summary.uncollected)}
              <span className="ledger__note">円</span>
            </dd>
          </div>
        )}

        <div className="ledger__row">
          <dt className="ledger__label">
            平均単価
            <span className="ledger__note">プラン選択済み 1 人あたり</span>
          </dt>
          <dd className="ledger__value">
            {amount(summary.averagePerAttendee)}
            <span className="ledger__note">円</span>
          </dd>
        </div>

        {myShare && (
          <div className="ledger__row">
            <dt className="ledger__label">
              あなたの取り分
              <span className="ledger__note">按分後・見込み</span>
            </dt>
            <dd className="ledger__value">
              {amount(myShare.expectedRevenue)}
              <span className="ledger__note">円</span>
            </dd>
          </div>
        )}
      </dl>
      {/* 未集金の行を出さないときは、その読み方を説明する脚注も出さない。 */}
      {!hidden.has("difference") && (
        <p className="ledger__foot">
          ※未集金は、見込み売上から集金済みを引いた額です。
        </p>
      )}
    </div>
  );
}
