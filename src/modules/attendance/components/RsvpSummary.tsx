"use client";

import { yen } from "@/lib/format";
import type { EventPricePlanOption, MyRsvp, RsvpStatus } from "@/modules/events/types";

const STATUS_LABELS: Record<RsvpStatus, string> = {
  ATTENDING: "参加",
  WAITLISTED: "参加要望",
  DECLINED: "欠席",
};

interface RsvpSummaryProps {
  status: RsvpStatus;
  /** 参加要望のときの待ち順（1 始まり）。要望でなければ null。 */
  waitlistPosition: number | null;
  /** 自分を含む参加人数。 */
  partySize: number;
  /** 選んだ日時の短いラベル（11/21 など）。 */
  scheduleLabels: string[];
  /** 申込時に選んだ料金プラン。見つからなければ null。 */
  plan: EventPricePlanOption | null;
  /** 申込時点の割引の写し。定義が消えていても、申込んだときの額を出す。 */
  discounts: MyRsvp["discounts"];
  /** 割引を引いた支払額。プランが無ければ null。 */
  payable: number | null;
  /** ログイン中に答えた会員名。誰として答えたかを 1 行で添える。 */
  memberName: string | null;
  /**
   * 画面下の帯（`StickyRsvpBar`）が変更の入口を持つか。
   * 持つときは、本文のボタンを広い画面だけに出す（朱を 2 つ並べない）。
   */
  barEntry?: boolean;
  onOpen: () => void;
}

/**
 * 答えたあとに面へ残す 1 枚。出欠は層へ移したが、**結果は読む情報**なので紙に残す。
 * ここを層の中だけに置くと、自分の支払額を見るために毎回モーダルを開くことになる。
 *
 * 出すのは、出欠の状態と支払額、変更への入口の 3 つだけ。
 * 割引の内訳や回答の取り消しは、開いた層（`DynamicRsvpBox`）が持つ。
 */
export function RsvpSummary({
  status,
  waitlistPosition,
  partySize,
  scheduleLabels,
  plan,
  discounts,
  payable,
  memberName,
  barEntry = false,
  onOpen,
}: RsvpSummaryProps) {
  const discountTotal = discounts.reduce((total, row) => total + Math.max(0, row.amount), 0);
  const size = partySize >= 1 ? partySize : 1;

  return (
    <section id="rsvp" className={barEntry ? "rsvp-summary rsvp-summary--bar" : "rsvp-summary"}>
      <p className="eyebrow">出欠</p>
      <p className="rsvp-summary__status">
        <span className="rsvp-summary__mark">{STATUS_LABELS[status]}</span>
        {status === "ATTENDING" && ` ${size}人`}
        {status === "WAITLISTED" && waitlistPosition !== null && `（${waitlistPosition}番目）`}
        {memberName && <span className="rsvp-summary__who">{memberName} さん</span>}
      </p>
      {status !== "DECLINED" && scheduleLabels.length > 0 && (
        <p className="rsvp-summary__meta">{scheduleLabels.join("・")}</p>
      )}
      {status === "ATTENDING" && plan && (
        <p className="rsvp-summary__amount">
          {plan.price}
          {size > 1 && ` × ${size}人`}
          {discountTotal > 0 && ` − 割引 ${yen(discountTotal * size)}`}
          {" = "}
          <strong>{yen(payable ?? plan.amount * size)}</strong>
        </p>
      )}
      {status === "WAITLISTED" && (
        <p className="rsvp-summary__note">空きが出たら、幹事が順番に承認します。</p>
      )}
      {status === "DECLINED" && <p className="rsvp-summary__note">案内は届きません。</p>}
      <div className="rsvp-summary__actions">
        <button type="button" className="btn btn--outline btn--block" onClick={onOpen}>
          回答を変更する
        </button>
      </div>
    </section>
  );
}
