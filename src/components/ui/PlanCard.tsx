import type { ReactNode } from "react";
import { yen, yenDigits } from "@/lib/format";
import { FIRST_MONTH_FREE_LABEL, type ServicePlan } from "@/modules/billing/lib/plans";

/**
 * 料金の札 1 枚。表示だけを持ち、どの金額を出すかは `plans.ts` が決める。
 *
 * 月額プランは初月無料があるので、価格を「初月0円」と「2か月目から」の 2 段で組む。
 * 初月無料と価格キャンペーンは併用しない規則なので、初月無料がある札では
 * 割引の札と販売価格を出さない（定価だけを 2 か月目の金額として見せる）。
 *
 * `Rows` と同じく、一覧の 1 要素として `<li>` を返す。呼び出し側は
 * `<ul className="plan-list">` で並べる。
 *
 * `showBody` を false にすると、札の説明文（`screen-note`）を出さない。
 * ホームは金額と初月0円だけを見せ、比較は /service に任せる。
 *
 * `children` は札の中の操作（プラン画面の「このプランを始める」など）。価格と
 * 特典を読んだあとに押すものなので、一覧の下に置く。渡さなければ何も出さない。
 */
export function PlanCard({
  plan,
  showBody = true,
  children,
}: {
  plan: ServicePlan;
  showBody?: boolean;
  /** 札の中に置く操作。ホームと /service は渡さない。 */
  children?: ReactNode;
}) {
  const trial = plan.trialMonths > 0;
  const discounted = !trial && plan.discountPercent > 0 && plan.listPriceYen !== plan.priceYen;

  return (
    <li className={`plan-card${plan.recommended ? " plan-card--pick" : ""}`}>
      <p className="plan-card__name">{plan.name}</p>
      {trial ? (
        <p className="plan-card__badge">{FIRST_MONTH_FREE_LABEL}</p>
      ) : (
        plan.discountPercent > 0 && (
          <p className="plan-card__badge">
            {plan.discountPercent >= 100 ? "全額無料" : `${plan.discountPercent}%OFF`}
            {plan.campaignName ? ` ・ ${plan.campaignName}` : ""}
          </p>
        )
      )}
      {trial ? (
        <p className="plan-card__price">
          {yenDigits(0)}
          <small>円 / 初月</small>
          <span className="plan-card__list-price plan-card__list-price--trial">
            2か月目から {yen(plan.listPriceYen)} / 月
          </span>
        </p>
      ) : (
        <p className="plan-card__price">
          {yenDigits(plan.priceYen)}
          <small>円 / {plan.unit}</small>
          {discounted && <s className="plan-card__list-price">定価 {yen(plan.listPriceYen)}</s>}
        </p>
      )}
      {showBody && <p className="screen-note">{plan.body}</p>}
      <ul className="plan-card__list">
        {plan.highlights.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
      {discounted && plan.campaignEndsAt && (
        <p className="help">{endsAtLabel(plan.campaignEndsAt)} までの販売価格です。</p>
      )}
      {children ? <div className="plan-card__action">{children}</div> : null}
    </li>
  );
}

/**
 * 販売価格の期限。全員に同じ時刻を見せるので、端末ではなく日本時間で出す。
 */
function endsAtLabel(iso: string): string {
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}
