"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRsvp } from "@/modules/attendance/hooks/useRsvp";
import { nextRsvpChoices } from "@/modules/events/lib/rsvp-status";
import {
  GENDER_LABELS,
  PRICE_AUDIENCE_LABELS,
  type EventDiscountOption,
  type EventPricePlanOption,
  type EventScheduleOption,
  type Gender,
  type MyRsvp,
  type RsvpStatus,
} from "@/modules/events/types";
import { yen } from "@/lib/format";
import { Alert, Dialog } from "@/components/ui";

interface DynamicRsvpBoxProps {
  eventId: string;
  schedules: EventScheduleOption[];
  pricePlans: EventPricePlanOption[];
  /** 参加者が申込時に選べる割引。0 件ならモーダルを出さず、そのまま送る。 */
  discounts: EventDiscountOption[];
  initialRsvp: MyRsvp | null;
  capacity: number | null;
  attendingCount: number;
  waitlistCount: number;
  closed: boolean;
  closedMessage?: string;
  /** ログイン中の会員名。誰として答えるかの 1 行に出す。 */
  memberName?: string | null;
  /** ログイン導線。今の告知ページへ戻れるよう、呼び出し側が next を付ける。 */
  loginHref?: string;
  /**
   * 下書きプレビュー。見た目だけ出し、送信もフォーカスもさせない。
   * RSVP API は呼ばない。
   */
  preview?: boolean;
  onCountChange: (count: number) => void;
  onWaitlistCountChange?: (count: number) => void;
}

const GENDERS: Gender[] = ["MALE", "FEMALE"];

export function DynamicRsvpBox({
  eventId,
  schedules,
  pricePlans,
  discounts,
  initialRsvp,
  capacity,
  attendingCount,
  waitlistCount,
  closed,
  closedMessage = "このイベントは出欠を受け付けていません。",
  memberName = null,
  loginHref,
  preview = false,
  onCountChange,
  onWaitlistCountChange,
}: DynamicRsvpBoxProps) {
  const { myRsvp, submit, cancel, isSubmitting, error } = useRsvp(eventId, initialRsvp);
  const locked = closed || isSubmitting || preview;
  /**
   * 満員なら「出席」の代わりに「参加要望」を出す。
   * 席を確保済みの出席者は、満員になっても出席のまま変更できる。
   */
  const choices = useMemo(
    () => nextRsvpChoices({ capacity, attendingCount, myStatus: myRsvp?.status ?? null }),
    [capacity, attendingCount, myRsvp?.status],
  );
  /** 「出席」の位置に入る値。満員なら参加要望になる。 */
  const attendValue: RsvpStatus = choices.attend ? "ATTENDING" : "WAITLISTED";
  const [name, setName] = useState(initialRsvp?.name ?? "");
  const [status, setStatus] = useState<RsvpStatus>(
    initialRsvp?.status ??
      (nextRsvpChoices({ capacity, attendingCount, myStatus: null }).attend
        ? "ATTENDING"
        : "WAITLISTED"),
  );
  const [gender, setGender] = useState<Gender | "">(initialRsvp?.gender ?? "");
  const [comment, setComment] = useState(initialRsvp?.comment ?? "");
  const [scheduleId, setScheduleId] = useState(
    schedules.some((row) => row.id === initialRsvp?.scheduleId) ? (initialRsvp?.scheduleId ?? "") : (schedules[0]?.id ?? ""),
  );
  const [pricePlanId, setPricePlanId] = useState(initialRsvp?.pricePlanId ?? "");
  /**
   * 申込時に選んだ割引の ID。回答済みなら、その写しの discountId を初期値にする
   * （定義が消えている古い回答は null なので外れる）。
   */
  const [discountIds, setDiscountIds] = useState<string[]>(
    (initialRsvp?.discounts ?? []).flatMap((row) => (row.discountId ? [row.discountId] : [])),
  );
  /** モーダルで選んでいる途中の値。確定するまで送信には使わない。 */
  const [checkedDiscounts, setCheckedDiscounts] = useState<string[]>([]);
  const [discountOpen, setDiscountOpen] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setName(initialRsvp?.name ?? "");
    setStatus(initialRsvp?.status ?? "ATTENDING");
    setGender(initialRsvp?.gender ?? "");
    setComment(initialRsvp?.comment ?? "");
    setScheduleId(
      schedules.some((row) => row.id === initialRsvp?.scheduleId) ? (initialRsvp?.scheduleId ?? "") : (schedules[0]?.id ?? ""),
    );
    setPricePlanId(initialRsvp?.pricePlanId ?? "");
    setDiscountIds(
      (initialRsvp?.discounts ?? []).flatMap((row) => (row.discountId ? [row.discountId] : [])),
    );
  }, [initialRsvp, schedules]);

  // 満員と空きありが入れ替わったとき、選んでいる「出席」を参加要望（またはその逆）へ合わせる。
  // マウント直後にも走るので、未回答の初期値もここで決まる。
  useEffect(() => {
    setStatus((current) => (current === "DECLINED" ? current : attendValue));
  }, [attendValue]);

  /** 性別に合うプランだけ選べる。未選択のうちは共通プランだけ出す。 */
  const availablePlans = useMemo(() => {
    if (!gender) return pricePlans.filter((row) => row.audience === "ANY");
    return pricePlans.filter((row) => row.audience === "ANY" || row.audience === gender);
  }, [gender, pricePlans]);

  const selectedPlanId = availablePlans.some((row) => row.id === pricePlanId)
    ? pricePlanId
    : (availablePlans[0]?.id ?? "");

  const hasOnlyCommonPlans = pricePlans.every((row) => row.audience === "ANY");
  const selectedPlan = availablePlans.find((row) => row.id === selectedPlanId) ?? null;
  const hasDiscounts = discounts.length > 0;

  /** モーダルで選んでいる割引の合計と、料金から引いた支払額。0 円で止める。 */
  const checkedRows = discounts.filter((row) => checkedDiscounts.includes(row.id));
  const checkedDiscountTotal = checkedRows.reduce((total, row) => total + Math.max(0, row.amount), 0);
  const checkedPayable =
    selectedPlan === null ? null : Math.max(0, selectedPlan.amount - checkedDiscountTotal);

  /** 回答済みの表示。料金は選んだプランの金額から引き、0 円で止める。 */
  const answeredPlan = pricePlans.find((row) => row.id === myRsvp?.pricePlanId) ?? null;
  const answeredDiscountTotal = (myRsvp?.discounts ?? []).reduce(
    (total, row) => total + Math.max(0, row.amount),
    0,
  );
  const answeredPayable =
    answeredPlan === null ? null : Math.max(0, answeredPlan.amount - answeredDiscountTotal);

  const save = async (ids: string[]) => {
    const result = await submit({
      name: name.trim(),
      status,
      gender: gender || undefined,
      comment: comment.trim(),
      scheduleId,
      pricePlanId: selectedPlanId,
      discountIds: ids,
    });
    if (typeof result.attendingCount === "number") onCountChange(result.attendingCount);
    if (typeof result.waitlistCount === "number") onWaitlistCountChange?.(result.waitlistCount);
    setDiscountIds(ids);
    setSaved(true);
  };

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (preview) return;
    // 割引があるときは、送る前にモーダルで選ばせる。「割引なし」もそのまま選べる。
    if (hasDiscounts && status === "ATTENDING") {
      setCheckedDiscounts(discountIds);
      setDiscountOpen(true);
      return;
    }
    await save(discountIds);
  };

  /** モーダルの「この内容で申し込む」。選んだ割引を確定してから送る。 */
  const onConfirmDiscounts = async () => {
    const ids = checkedDiscounts;
    setDiscountOpen(false);
    await save(ids);
  };

  const onCancel = async () => {
    if (preview) return;
    const result = await cancel();
    if (typeof result.attendingCount === "number") onCountChange(result.attendingCount);
    if (typeof result.waitlistCount === "number") onWaitlistCountChange?.(result.waitlistCount);
    setName("");
    setComment("");
    setStatus(attendValue);
    setGender("");
    setScheduleId(schedules[0]?.id ?? "");
    setPricePlanId("");
    setDiscountIds([]);
    setSaved(false);
  };

  const loginLabel = preview ? (
    <span>ログイン</span>
  ) : loginHref ? (
    <Link href={loginHref}>ログイン</Link>
  ) : null;
  const switchLabel = preview ? (
    <span>アカウントを切り替える</span>
  ) : loginHref ? (
    <Link href={loginHref}>アカウントを切り替える</Link>
  ) : null;

  return (
    <section id="rsvp" className="rsvp">
      <p className="eyebrow">出欠</p>
      <h2 className="rsvp__title">
        {myRsvp
          ? "回答済み・変更できます"
          : choices.mode === "full"
            ? "定員に達しました"
            : "3秒で出欠を回答"}
      </h2>
      <p className="panel__note">
        {choices.mode === "full" && !myRsvp
          ? "空きが出たら、幹事が順番に承認します。参加要望として受け付けます。"
          : "アカウントは不要です。この端末に回答を覚えておきます。"}
      </p>
      {/* ログインは必須ではない。持っている人にだけ、あとから変えられることを添える。 */}
      {!memberName && loginHref && (
        <p className="rsvp__login">
          参加者アカウントをお持ちなら {loginLabel} すると、あとから答えを変えられます。
        </p>
      )}
      {myRsvp?.status === "WAITLISTED" && (
        <Alert tone="warning">
          参加要望中です。
          {myRsvp.waitlistPosition !== null && ` 現在 ${myRsvp.waitlistPosition} 番目です。`}
          {choices.mode === "open" && " 空きが出ました。出席に変更できます。"}
        </Alert>
      )}
      {/* 申込済みの割引。定義を編集・削除しても、ここは申込時点の写しを出す。 */}
      {myRsvp?.status === "ATTENDING" && myRsvp.discounts.length > 0 && (
        <div className="discount-applied">
          <p className="label">適用中の割引</p>
          <ul className="discount-applied__list">
            {myRsvp.discounts.map((row, index) => (
              <li key={`${row.name}-${index}`} className="discount-applied__item">
                <span>{row.label}</span>
              </li>
            ))}
          </ul>
          {answeredPayable !== null && (
            <p className="discount-applied__total">
              支払額 <strong>{yen(answeredPayable)}</strong>
              {answeredDiscountTotal > 0 && (
                <span className="discount-applied__note">
                  （{yen(answeredPlan?.amount ?? 0)} − 割引 {yen(answeredDiscountTotal)}）
                </span>
              )}
            </p>
          )}
        </div>
      )}
      <form onSubmit={onSubmit} className="form form--spaced">
        {/* 誰として答えるか。ログイン中だけ、フォームの先頭に 1 行。 */}
        {memberName && (
          <p className="rsvp__member">
            <span>{memberName} さんとして答えます</span>
            {loginHref && switchLabel}
          </p>
        )}
        <fieldset className="field">
          <legend className="label">出欠</legend>
          <div className="rsvp__choices">
            <label className="rsvp__choice">
              <input
                type="radio"
                name="rsvp"
                checked={status === attendValue}
                disabled={locked}
                onChange={() => setStatus(attendValue)}
              />
              <span>
                {choices.attend ? "出席する" : "参加を希望する"}
                <small>{choices.attend ? "あとから変更できます" : "空きが出たら連絡します"}</small>
              </span>
            </label>
            <label className="rsvp__choice">
              <input
                type="radio"
                name="rsvp"
                checked={status === "DECLINED"}
                disabled={locked}
                onChange={() => setStatus("DECLINED")}
              />
              <span>
                欠席する
                <small>案内は届きません</small>
              </span>
            </label>
          </div>
          {!choices.attend && (
            <p className="rsvp__alert" role="status">
              <strong>定員 {capacity}名に達しました。</strong>
              いまは参加要望（待ち順）として受け付けます。空きが出たら、幹事が順番に承認します。
            </p>
          )}
        </fieldset>
        {status === "ATTENDING" && (
          <>
            {!hasOnlyCommonPlans && (
              <fieldset className="field">
                <legend className="label">
                  性別 <span className="req">*</span>
                </legend>
                <div className="choice-group" style={{ gridTemplateColumns: "1fr 1fr" }}>
                  {GENDERS.map((value) => (
                    <label key={value} className="choice">
                      <input
                        type="radio"
                        name="gender"
                        required
                        checked={gender === value}
                        disabled={locked}
                        onChange={() => setGender(value)}
                      />
                      {GENDER_LABELS[value]}
                    </label>
                  ))}
                </div>
                <p className="help">性別によって選べる費用プランが変わります。</p>
              </fieldset>
            )}
            {/* 日時が 1 件だけなら選ぶ余地がない。state の初期値（唯一の日時）を
                そのまま送り、読み手の判断を増やさない。 */}
            {schedules.length > 1 && (
              <fieldset className="field">
                <legend className="label">出席する日時</legend>
                <div className="choice-group choice-group--stack">
                  {schedules.map((row) => (
                    <label key={row.id} className="choice choice--left">
                      <input
                        type="radio"
                        name="schedule"
                        required
                        checked={scheduleId === row.id}
                        disabled={locked}
                        onChange={() => setScheduleId(row.id)}
                      />
                      {row.eventDate} {row.eventTime}
                    </label>
                  ))}
                </div>
              </fieldset>
            )}
            {/* 0 件は選べないので案内だけ出す。1 件は selectedPlanId が唯一のプランを指す。 */}
            {availablePlans.length === 0 && (
              <fieldset className="field">
                <legend className="label">費用プラン</legend>
                <Alert tone="warning">
                  {gender
                    ? "この性別で選べる費用プランがありません。幹事に確認してください。"
                    : "性別を選ぶと費用プランが表示されます。"}
                </Alert>
              </fieldset>
            )}
            {availablePlans.length > 1 && (
              <fieldset className="field">
                <legend className="label">費用プラン</legend>
                <div className="choice-group choice-group--stack">
                  {availablePlans.map((row) => (
                    <label key={row.id} className="choice choice--left">
                      <input
                        type="radio"
                        name="price-plan"
                        required
                        checked={selectedPlanId === row.id}
                        disabled={locked}
                        onChange={() => setPricePlanId(row.id)}
                      />
                      {row.audience === "ANY" ? "" : `${PRICE_AUDIENCE_LABELS[row.audience]} `}
                      {row.name} {row.price}
                    </label>
                  ))}
                </div>
              </fieldset>
            )}
          </>
        )}
        <div className="field">
          <label className="label">
            お名前 <span className="req">*</span>
          </label>
          <input
            required
            maxLength={50}
            value={name}
            disabled={locked}
            onChange={(event) => setName(event.target.value)}
            className="input"
            placeholder="佐藤"
          />
        </div>
        <div className="field">
          <label className="label">コメント（任意）</label>
          <textarea
            maxLength={500}
            value={comment}
            disabled={locked}
            onChange={(event) => setComment(event.target.value)}
            rows={3}
            className="textarea"
            placeholder="楽しみにしています"
          />
        </div>
        {error && <Alert tone="error">{error}</Alert>}
        {saved && !error && (
          <Alert tone="success">
            {status === "WAITLISTED"
              ? `参加要望を受け付けました。空きが出たら幹事が承認します。${
                  myRsvp?.waitlistPosition !== null && myRsvp?.waitlistPosition !== undefined
                    ? `（${myRsvp.waitlistPosition}番目）`
                    : ""
                }`
              : "回答を保存しました。"}
          </Alert>
        )}
        <div className="rsvp__foot">
          <button
            type="submit"
            disabled={locked || (status === "ATTENDING" && availablePlans.length === 0)}
            className="btn btn--primary btn--block"
          >
            {isSubmitting
              ? "送信中…"
              : myRsvp
                ? "回答を更新する"
                : status === "WAITLISTED"
                  ? "参加要望を送る"
                  : "この内容で回答を送信"}
          </button>
        </div>
        {myRsvp && (
          <button type="button" onClick={() => void onCancel()} disabled={locked} className="btn btn--ghost btn--block">
            回答を取り消す
          </button>
        )}
        {closed && !preview && <Alert tone="warning">{closedMessage}</Alert>}
      </form>
      {/* 割引があるときだけ、送信の直前に選ばせる。チェックを外せば「割引なし」で申し込める。 */}
      {discountOpen && (
        <Dialog
          title="割引を選ぶ"
          titleId="discount-picker-title"
          onClose={() => setDiscountOpen(false)}
          actions={
            <>
              <button
                type="button"
                className="btn btn--primary btn--block"
                disabled={isSubmitting}
                onClick={() => void onConfirmDiscounts()}
              >
                {isSubmitting ? "送信中…" : "この内容で申し込む"}
              </button>
              <button
                type="button"
                className="btn btn--ghost btn--block"
                disabled={isSubmitting}
                onClick={() => setDiscountOpen(false)}
              >
                やめる
              </button>
            </>
          }
        >
          <p className="dialog__body">
            使う割引にチェックを入れてください。当てはまるものがなければ、そのままで大丈夫です。
          </p>
          <div className="discount-picker">
            {discounts.map((row) => (
              <label key={row.id} className="check discount-picker__row">
                <input
                  type="checkbox"
                  checked={checkedDiscounts.includes(row.id)}
                  disabled={isSubmitting}
                  onChange={(event) =>
                    setCheckedDiscounts((current) =>
                      event.target.checked
                        ? [...current, row.id]
                        : current.filter((id) => id !== row.id),
                    )
                  }
                />
                <span>
                  {row.label}
                </span>
              </label>
            ))}
          </div>
          <dl className="discount-picker__summary">
            <div className="discount-picker__line">
              <dt>料金</dt>
              <dd>{selectedPlan ? selectedPlan.price : "未選択"}</dd>
            </div>
            <div className="discount-picker__line">
              <dt>割引</dt>
              <dd>{checkedDiscountTotal > 0 ? `−${yen(checkedDiscountTotal)}` : "なし"}</dd>
            </div>
            <div className="discount-picker__line discount-picker__line--total">
              <dt>支払額</dt>
              <dd>{checkedPayable === null ? "未選択" : yen(checkedPayable)}</dd>
            </div>
          </dl>
        </Dialog>
      )}
    </section>
  );
}
