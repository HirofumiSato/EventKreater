"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import Link from "next/link";
import { ChevronDown } from "lucide-react";
import { useRsvp } from "@/modules/attendance/hooks/useRsvp";
import { RsvpSummary } from "@/modules/attendance/components/RsvpSummary";
import {
  resolveSelectedPlanId,
  rsvpPlanChoices,
  rsvpScheduleChoices,
  rsvpSubmitName,
  selectableRsvpPlans,
  showsRsvpNameField,
} from "@/modules/attendance/lib/rsvp-form";
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
import { Toast } from "@/components/common/Toast";
import { Alert, Dialog } from "@/components/ui";

interface DynamicRsvpBoxProps {
  eventId: string;
  schedules: EventScheduleOption[];
  pricePlans: EventPricePlanOption[];
  /** 参加者が申込時に選べる割引。0 件なら割引の欄を出さない。 */
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
   * 下書きプレビュー。見た目だけ出し、送信もさせない。
   * 層は開ける（主催者が「出欠がどう出るか」を確かめられる）が、入力と送信は止める。
   */
  preview?: boolean;
  onCountChange: (count: number) => void;
  onWaitlistCountChange?: (count: number) => void;
  /** 答えたかどうかが変わったとき。画面下の帯の文言を、読み直さずに切り替える。 */
  onAnsweredChange?: (answered: boolean) => void;
  /**
   * 層を開いているか。画面下の帯（`StickyRsvpBar`）と入口を分け合うときは親が持つ。
   * 省略すると、この部品の中で持つ（プレビューと見本）。
   */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /**
   * 画面下の帯が入口を持つか。持つときは、面の「出欠を答える」を広い画面だけに出す。
   * 狭い画面で朱のボタンを 2 つ並べないため（帯は 768px 以上で消える）。
   */
  barEntry?: boolean;
}

const GENDERS: Gender[] = ["MALE", "FEMALE"];

/**
 * 出欠。**面（紙）と層（モーダル）に分かれている。**
 *
 * 告知ページは「告知」と「申込」の 2 役を 1 枚で担う。削れない売りである一方、
 * 読む面と決める面を同じ縦棒に積むと、読み終えたのに作業が残る感覚になる。
 * そこで役割は削らず、器だけを分ける。告知は 1 枚の紙として完結させ、
 * 申込は紙の上に立ち上がる層にする（紙は紙のまま、申込は上に乗る）。
 *
 * 面に残すのは、答えたあとの結果（`RsvpSummary`）と、未回答なら入口の 1 ボタンだけ。
 * 層は閉じている間も `hidden` で DOM に残す。開き直したときに入力が消えず、
 * モック（`npm run mock:sync`）も同じ DOM をそのまま写せる。
 *
 * 層の中で畳むのは、任意の項目だけ（コメント・割引）。性別・日時・費用プランは
 * `required` なので畳まない。畳むと、既定値のまま送られて金額の事故になる。
 *
 * **選択によって欄を出し入れしない。** 性別・日時・費用プランは最初から並べ、
 * 欠席や参加要望のときは消さずにグレーアウトする（`lib/rsvp-form.ts`）。
 * あとから欄が現れると、そこへ何かを書かねばならないのではないかと身構えさせる。
 * ログイン中は会員名で答えるので、名前の欄と「アカウントを切り替える」は出さない。
 */
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
  onAnsweredChange,
  open,
  onOpenChange,
  barEntry = false,
}: DynamicRsvpBoxProps) {
  const { myRsvp, submit, cancel, isSubmitting, error } = useRsvp(eventId, initialRsvp);
  const locked = closed || isSubmitting || preview;

  /** 層の開閉。親が持つときはそれに従い、持たないときはこの部品で持つ。 */
  const [innerOpen, setInnerOpen] = useState(false);
  const isOpen = open ?? innerOpen;
  const setOpen = (next: boolean) => {
    setInnerOpen(next);
    onOpenChange?.(next);
  };

  /** 送った直後の 1 行。層を閉じたあと、面の要約と入れ替わりで読ませる。 */
  const [notice, setNotice] = useState<string | null>(null);

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

  /** 出席のときだけ、性別・日時・費用・割引を入力できる。 */
  const attending = status === "ATTENDING";
  /** ログイン中の会員名。空白だけなら未ログインとして扱う。 */
  const member = memberName?.trim() ?? "";
  const showNameField = showsRsvpNameField(memberName);

  /**
   * 性別に合うプラン。**表示は絞らない。** 絞ると、男女別プランしか無い催しで
   * 性別を選ぶまで費用の欄ごと消え、「選んだのに何も出ない」ように見える。
   * ここは「送ってよいプランか」の判定にだけ使う。
   */
  const selectablePlans = useMemo(
    () => selectableRsvpPlans(pricePlans, gender),
    [gender, pricePlans],
  );
  const selectedPlanId = resolveSelectedPlanId(pricePlans, gender, pricePlanId);
  const planChoices = rsvpPlanChoices({
    plans: pricePlans,
    gender,
    enabled: attending,
    locked,
    selectedPlanId,
  });
  const scheduleChoices = rsvpScheduleChoices({
    schedules,
    enabled: attending,
    locked,
    selectedScheduleId: scheduleId,
  });

  const hasOnlyCommonPlans = pricePlans.every((row) => row.audience === "ANY");
  const selectedPlan = pricePlans.find((row) => row.id === selectedPlanId) ?? null;
  const hasDiscounts = discounts.length > 0;

  /** 選んでいる割引の合計と、料金から引いた支払額。0 円で止める。 */
  const checkedRows = discounts.filter((row) => discountIds.includes(row.id));
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

  const close = () => setOpen(false);

  const save = async () => {
    try {
      const result = await submit({
        name: rsvpSubmitName(memberName, name),
        status,
        gender: gender || undefined,
        comment: comment.trim(),
        scheduleId,
        pricePlanId: selectedPlanId,
        discountIds,
      });
      if (typeof result.attendingCount === "number") onCountChange(result.attendingCount);
      if (typeof result.waitlistCount === "number") onWaitlistCountChange?.(result.waitlistCount);
      onAnsweredChange?.(true);
      setNotice(
        status === "WAITLISTED"
          ? `参加要望を受け付けました。${
              result.myRsvp?.waitlistPosition !== null && result.myRsvp?.waitlistPosition !== undefined
                ? `${result.myRsvp.waitlistPosition}番目です。`
                : "空きが出たら幹事が承認します。"
            }`
          : "回答を保存しました。",
      );
      // 決め終えたら層を閉じる。面の要約が、送った内容をそのまま受け取る。
      close();
    } catch {
      // 失敗は `useRsvp` が error に入れる。層は開いたまま、直せるようにする。
    }
  };

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (preview) return;
    await save();
  };

  const onCancel = async () => {
    if (preview) return;
    try {
      const result = await cancel();
      if (typeof result.attendingCount === "number") onCountChange(result.attendingCount);
      if (typeof result.waitlistCount === "number") onWaitlistCountChange?.(result.waitlistCount);
      onAnsweredChange?.(false);
      setName("");
      setComment("");
      setStatus(attendValue);
      setGender("");
      setScheduleId(schedules[0]?.id ?? "");
      setPricePlanId("");
      setDiscountIds([]);
      setNotice(null);
      close();
    } catch {
      // 失敗は `useRsvp` が error に入れる。
    }
  };

  // 通知は数秒で消す。閉じる印も残すので、待たずに消したい人も止められる。
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 5000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const loginLabel = preview ? (
    <span>ログイン</span>
  ) : loginHref ? (
    <Link href={loginHref}>ログイン</Link>
  ) : null;
  const sheetTitle = myRsvp ? "回答を変更" : choices.attend ? "出欠" : "参加要望";
  const submitLabel = isSubmitting
    ? "送信中…"
    : myRsvp
      ? "回答を更新"
      : status === "WAITLISTED"
        ? "参加要望を送る"
        : "回答を送る";

  return (
    <>
      {myRsvp ? (
        <RsvpSummary
          status={myRsvp.status}
          waitlistPosition={myRsvp.waitlistPosition}
          plan={answeredPlan}
          discounts={myRsvp.discounts}
          payable={answeredPayable}
          memberName={member || null}
          barEntry={barEntry}
          onOpen={() => setOpen(true)}
        />
      ) : (
        <section id="rsvp" className={barEntry ? "rsvp-entry rsvp-entry--bar" : "rsvp-entry"}>
          <p className="eyebrow">出欠</p>
          <h2 className="rsvp-entry__title">
            {closed ? "受付を終えました" : choices.mode === "full" ? "定員に達しました" : "3秒で出欠を回答"}
          </h2>
          <p className="rsvp-entry__note">
            {closed
              ? closedMessage
              : choices.mode === "full"
                ? "空きが出たら、幹事が順番に承認します。参加要望として受け付けます。"
                : "アカウントは不要です。この端末に回答を覚えておきます。"}
          </p>
          {closed ? (
            <button type="button" className="btn btn--primary btn--block" disabled>
              受付終了
            </button>
          ) : (
            <button type="button" className="btn btn--primary btn--block" onClick={() => setOpen(true)}>
              {choices.attend ? "出欠を答える" : "参加要望を出す"}
            </button>
          )}
        </section>
      )}

      <Dialog
        open={isOpen}
        variant="sheet"
        dismissOnBack
        title={sheetTitle}
        titleId="rsvp-sheet-title"
        onClose={close}
        closeLabel="出欠を閉じる"
        actions={
          <>
            <button
              type="submit"
              form="rsvp-form"
              disabled={locked || (attending && selectablePlans.length === 0)}
              className="btn btn--primary btn--block"
            >
              {submitLabel}
            </button>
            <button type="button" className="btn btn--ghost btn--block" onClick={close}>
              閉じる
            </button>
          </>
        }
      >
        {preview && <p className="dialog__note">この画面からは送信できません。</p>}
        {/* ログインは必須ではない。答える前に「あとから変えられる」と知らせたいので、
            送信の直前ではなく、層の一番上に 1 行だけ置く。 */}
        {showNameField && loginHref && (
          <p className="rsvp__login">
            {loginLabel}すると、あとから答えを変えられます。
          </p>
        )}
        <form id="rsvp-form" onSubmit={onSubmit} className="form form--spaced">
          {/* 誰として答えるか。ログイン中だけ、フォームの先頭に 1 行。
              会員名で答えるので、切り替えの導線は置かない（名前の欄も出さない）。 */}
          {member && (
            <p className="rsvp__member">
              <span>{member} さんとして答えます</span>
            </p>
          )}
          <fieldset className="field">
            {/* 題（`dialog__title`）が「出欠」なので、同じ言葉を 2 度見せない。
                読み上げのためだけに残す。 */}
            <legend className="visually-hidden">出欠</legend>
            <div className="rsvp__choices">
              <label className="rsvp__choice">
                <input
                  type="radio"
                  name="rsvp"
                  value={attendValue}
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
                  value="DECLINED"
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
          {/* 性別・日時・費用は、選択によって出し入れしない。欠席や参加要望のときも
              欄は残したままグレーアウトする（あとから欄が現れると身構えさせる）。
              性別は、どの催しでも聞く必要があるときだけ出す。 */}
          {!hasOnlyCommonPlans && (
            <fieldset className={attending ? "field" : "field field--disabled"}>
              <legend className="label">
                性別 <span className="req">*</span>
              </legend>
              <div className="choice-group choice-group--compact">
                {GENDERS.map((value) => (
                  <label key={value} className="choice">
                    <input
                      type="radio"
                      name="gender"
                      value={value}
                      required
                      checked={gender === value}
                      disabled={locked || !attending}
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
            <fieldset className={attending ? "field" : "field field--disabled"}>
              <legend className="label">出席する日時</legend>
              {/* 3 件までは 1 行に並べる。4 件以上は 2 段目へ回り、札が細くなりすぎない。 */}
              <div className="choice-group choice-group--schedule">
                {scheduleChoices.map(({ schedule: row, disabled, checked }) => (
                  <label key={row.id} className="choice choice--schedule">
                    <input
                      type="radio"
                      name="schedule"
                      value={row.id}
                      required
                      checked={checked}
                      disabled={disabled}
                      onChange={() => setScheduleId(row.id)}
                    />
                    <span className="choice__date">{row.eventDate}</span>
                    <span className="choice__time">{row.eventTime}</span>
                  </label>
                ))}
              </div>
            </fieldset>
          )}
          {/* 費用プランは、性別が未選択でも全部の札を出す。絞ると、性別を選ぶまで
              費用の欄ごと消え、「選んだのに何も出ない」ように見える。 */}
          {pricePlans.length > 0 && (
            <fieldset className={attending ? "field" : "field field--disabled"}>
              <legend className="label">費用プラン</legend>
              <div className="choice-group choice-group--plans">
                {planChoices.map(({ plan: row, disabled, checked }) => (
                  <label key={row.id} className="choice choice--plan">
                    <input
                      type="radio"
                      name="price-plan"
                      value={row.id}
                      data-audience={row.audience}
                      required
                      checked={checked}
                      disabled={disabled}
                      onChange={() => setPricePlanId(row.id)}
                    />
                    <span className="choice__name">
                      {row.audience === "ANY" ? "" : `${PRICE_AUDIENCE_LABELS[row.audience]} `}
                      {row.name}
                    </span>
                    <span className="choice__price">
                      {row.amount === 0 ? "無料" : yen(row.amount)}
                    </span>
                    {row.note && <span className="choice__note">{row.note}</span>}
                  </label>
                ))}
              </div>
              {attending && !hasOnlyCommonPlans && gender === "" && (
                <p className="help">性別を選ぶと、選べる費用プランが変わります。</p>
              )}
              {attending && gender !== "" && selectablePlans.length === 0 && (
                <p className="help">この性別で選べる費用プランがありません。幹事に確認してください。</p>
              )}
            </fieldset>
          )}
          {pricePlans.length === 0 && attending && (
            <Alert tone="warning">
              このイベントには費用プランが登録されていません。幹事に確認してください。
            </Alert>
          )}
          {/* ログイン中は会員名で答えるので、名前の欄は出さない（送信名は会員名）。 */}
          {showNameField && (
            <div className="field">
              <label className="label" htmlFor="rsvp-name">
                お名前 <span className="req">*</span>
              </label>
              <input
                id="rsvp-name"
                required
                maxLength={50}
                value={name}
                disabled={locked}
                onChange={(event) => setName(event.target.value)}
                className="input"
                placeholder="佐藤"
              />
            </div>
          )}
          {/* 任意の項目だけを畳む。必須の項目（性別・日時・費用）は畳まない。
              畳むと既定値のまま送られ、金額の事故になる。
              割引は欠席・参加要望でも欄を残し、選べないだけにする。 */}
          {hasDiscounts && (
            <details className={attending ? "rsvp-extras" : "rsvp-extras rsvp-extras--disabled"}>
              <summary className="rsvp-extras__summary">
                <span className="rsvp-extras__label">
                  割引を選ぶ
                  {discountIds.length > 0 && (
                    <span className="rsvp-extras__count">{discountIds.length}件</span>
                  )}
                </span>
                <ChevronDown className="icon rsvp-extras__chevron" aria-hidden="true" />
              </summary>
              <div className="rsvp-extras__body">
                <p className="help">当てはまるものだけ選んでください。</p>
                <div className="discount-picker">
                  {discounts.map((row) => (
                    <label key={row.id} className="check discount-picker__row">
                      <input
                        type="checkbox"
                        checked={discountIds.includes(row.id)}
                        disabled={locked || !attending}
                        onChange={(event) =>
                          setDiscountIds((current) =>
                            event.target.checked
                              ? [...current, row.id]
                              : current.filter((id) => id !== row.id),
                          )
                        }
                      />
                      <span>{row.label}</span>
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
              </div>
            </details>
          )}
          <details className="rsvp-extras">
            <summary className="rsvp-extras__summary">
              <span className="rsvp-extras__label">
                ひとこと添える
                <span className="rsvp-extras__optional">任意</span>
              </span>
              <ChevronDown className="icon rsvp-extras__chevron" aria-hidden="true" />
            </summary>
            <div className="rsvp-extras__body">
              <label className="label" htmlFor="rsvp-comment">
                コメント
              </label>
              <textarea
                id="rsvp-comment"
                maxLength={500}
                value={comment}
                disabled={locked}
                onChange={(event) => setComment(event.target.value)}
                rows={3}
                className="textarea"
                placeholder="楽しみにしています"
              />
            </div>
          </details>
          {error && <Alert tone="error">{error}</Alert>}
          {closed && !preview && <Alert tone="warning">{closedMessage}</Alert>}
          {myRsvp && (
            <button
              type="button"
              onClick={() => void onCancel()}
              disabled={locked}
              className="btn btn--ghost btn--block"
            >
              回答を取り消す
            </button>
          )}
        </form>
      </Dialog>

      {notice && <Toast message={notice} onClose={() => setNotice(null)} />}
    </>
  );
}
