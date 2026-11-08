"use client";

import { useState } from "react";
import {
  GENDER_LABELS,
  PRICE_AUDIENCE_LABELS,
  type EventPricePlanOption,
  type EventScheduleOption,
  type Gender,
  type ParticipantRow,
  type RsvpStatus,
} from "@/modules/events/types";
import { rsvpStatusLabel } from "@/modules/events/lib/rsvp-status";
import {
  RSVP_COMMENT_MAX,
  RSVP_NAME_MAX,
  RSVP_PARTY_SIZE_MAX,
  RSVP_PARTY_SIZE_MIN,
  clampRsvpPartySize,
} from "@/modules/attendance/lib/rsvp-form";
import { formatDateWithWeekdayJa, formatDateTimeJa } from "@/lib/format";
import { readProblem } from "@/lib/problem";
import { Dialog, Field } from "@/components/ui";

/** 保存で送る値。`ParticipantListTable` の `onSave` と同じ形にする。 */
export type ParticipantDraft = Pick<
  ParticipantRow,
  "name" | "status" | "gender" | "comment" | "scheduleId" | "scheduleIds" | "partySize" | "pricePlanId"
> & {
  /** 追加は null（POST）。編集は行の ID（PATCH）。 */
  id: string | null;
};

interface ParticipantSheetProps {
  /** 集金の切り替えを送る先。名簿のページから渡す。 */
  eventId: string;
  /** 追加は null。削除済みかは `row.deletedAt` で見る。 */
  row: ParticipantRow | null;
  schedules: EventScheduleOption[];
  pricePlans: EventPricePlanOption[];
  /** 定員の案内に使う。 */
  capacity: number | null;
  /** いま名簿に載っている出席の人数。定員の案内に使う。 */
  attendingCount: number;
  busy?: boolean;
  onClose: () => void;
  onSave: (draft: ParticipantDraft) => Promise<void>;
  onDelete?: (id: string) => Promise<void>;
  /** 削除済みの行を名簿へ戻す。 */
  onRestore?: (id: string) => Promise<void>;
  /** 集金を切り替えたあとに名簿と売上を合わせる。1 枚の中だけで持つと、閉じたあとが古いままになる。 */
  onCollectedChange?: (id: string, collectedAt: string | null) => void;
}

/**
 * 名簿の 1 枚。追加・編集・削除済みの 3 つの出し方を持つ。
 *
 * 表に操作の列を置かない代わりに、直すときだけこの層を出す。表は読むためだけに使い、
 * 列の幅を操作に奪われないようにする。出欠・人数・日時・料金プランは `required` に近い扱いで、
 * 参加のときは日時を 1 つ以上選ばないと保存できない（既定のまま送ると金額の事故になる）。
 *
 * 追加は `row` が null。名簿の行と同じ欄を出し、保存の送り先（POST か PATCH か）は
 * 呼び出し元が `draft.id` で決める。削除済みの行は入力欄を出さず、名簿に戻すことだけを出す。
 */
export function ParticipantSheet({
  eventId,
  row,
  schedules,
  pricePlans,
  capacity,
  attendingCount,
  busy = false,
  onClose,
  onSave,
  onDelete,
  onRestore,
  onCollectedChange,
}: ParticipantSheetProps) {
  const creating = row === null;
  /** 削除済みの行。入力欄・集金・削除を出さず、戻すだけにする。 */
  const deletedRow = row !== null && row.deletedAt !== null ? row : null;
  /** 削除の送り先。追加には行が無いので null。 */
  const rowId = row?.id ?? null;

  const [name, setName] = useState(row?.name ?? "");
  const [comment, setComment] = useState(row?.comment ?? "");
  // 追加の初期値は名簿の承認と同じ（出席・1 人・先頭の日時・性別に合う先頭のプラン）。
  const [status, setStatus] = useState<RsvpStatus>(row?.status ?? "ATTENDING");
  const [gender, setGender] = useState<Gender | "">(row?.gender ?? "");
  const [scheduleIds, setScheduleIds] = useState<string[]>(() => {
    const chosen = row?.scheduleIds ?? [];
    if (chosen.length > 0) return chosen;
    if (row?.scheduleId) return [row.scheduleId];
    // 追加は先頭の日時を選んでおく。出席は日時が 0 件だと保存できない。
    return schedules.length > 0 ? [schedules[0].id] : [];
  });
  const [partySize, setPartySize] = useState(String(row?.partySize ?? 1));
  const allowedPlans = pricePlans.filter(
    (plan) => plan.audience === "ANY" || (gender !== "" && plan.audience === gender),
  );
  const chosenPlanId = row?.pricePlanId ?? null;
  const [pricePlanId, setPricePlanId] = useState(
    chosenPlanId && allowedPlans.some((plan) => plan.id === chosenPlanId)
      ? chosenPlanId
      : (allowedPlans[0]?.id ?? ""),
  );

  const attending = status === "ATTENDING";
  const waitlisted = row?.status === "WAITLISTED";

  /**
   * 定員の案内。保存は止めない（席を取れるかはサーバーが判定する）。
   * 編集では `attendingCount` に編集中の行の人数が既に入っているので、その分を引く。
   * 引かないと、席がちょうど収まる行でも「定員に達しています」と出てしまう。
   */
  const nextPartySize = clampRsvpPartySize(partySize);
  const ownSeats = row?.status === "ATTENDING" ? row.partySize : 0;
  const overCapacity =
    capacity !== null && attendingCount - ownSeats + nextPartySize > capacity;

  /**
   * 集金の記録。親の `row` は書き換えず、この 1 枚の中だけで持つ。
   * 押した瞬間に送り、出欠は送らない（保存ボタンとは別の操作）。
   */
  const [collectedAt, setCollectedAt] = useState<string | null>(row?.collectedAt ?? null);
  const [collectionBusy, setCollectionBusy] = useState(false);
  const [collectionError, setCollectionError] = useState<string | null>(null);
  // 記録できるのは出席だけ。画面で出欠を変えても、保存するまではサーバーの状態に合わせる。
  const canCollect = row !== null && row.status === "ATTENDING";

  const toggleCollection = async () => {
    if (!row) return;
    setCollectionBusy(true);
    setCollectionError(null);
    try {
      const res = await fetch(
        `/api/v1/organizer/events/${eventId}/participants/${row.id}/collection`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ collected: collectedAt === null }),
        },
      );
      if (!res.ok) throw new Error(await readProblem(res));
      const body = (await res.json()) as { participant: { collectedAt: string | null } };
      setCollectedAt(body.participant.collectedAt);
      onCollectedChange?.(row.id, body.participant.collectedAt);
    } catch (cause) {
      setCollectionError(
        cause instanceof Error ? cause.message : "集金を記録できませんでした。",
      );
    } finally {
      setCollectionBusy(false);
    }
  };

  const pickGender = (next: Gender | "") => {
    setGender(next);
    const allowed = pricePlans.filter(
      (plan) => plan.audience === "ANY" || (next !== "" && plan.audience === next),
    );
    if (!allowed.some((plan) => plan.id === pricePlanId)) setPricePlanId(allowed[0]?.id ?? "");
  };

  const save = (nextStatus: RsvpStatus) =>
    void onSave({
      // 追加はまだ行が無い。送り先は呼び出し元がこの null で決める。
      id: row?.id ?? null,
      name: name.trim() || (row?.name ?? ""),
      status: nextStatus,
      // 欠席のあいだは性別を変えない（プランの対象が消えるため）。
      gender: nextStatus === "DECLINED" ? (row?.gender ?? null) : gender || null,
      comment,
      // 代表は並び順で最初の日時。押した順ではなくイベントの順で送る。
      scheduleId:
        nextStatus === "ATTENDING"
          ? (schedules.find((schedule) => scheduleIds.includes(schedule.id))?.id ?? null)
          : null,
      scheduleIds: nextStatus === "ATTENDING" ? scheduleIds : [],
      partySize: nextStatus === "ATTENDING" ? clampRsvpPartySize(partySize) : 1,
      pricePlanId: nextStatus === "ATTENDING" ? pricePlanId : null,
    });

  /**
   * 保存できるか。追加は名前が要る（誰の行か決まらない）。
   * 出席は日時と料金プランが要る（`refineAttendanceChoice` と同じ条件で、無いとサーバーも断る）。
   */
  const canSave = (!creating || name.trim() !== "") && (!attending || (scheduleIds.length > 0 && pricePlanId !== ""));

  return (
    <Dialog
      variant="sheet"
      title={creating ? "参加者を追加" : (row?.name ?? "")}
      titleId="participant-sheet-title"
      onClose={onClose}
      actions={
        deletedRow ? (
          <>
            {onRestore && (
              <button
                type="button"
                className="btn btn--primary btn--block"
                disabled={busy}
                onClick={() => void onRestore(deletedRow.id)}
              >
                名簿に戻す
              </button>
            )}
            <button type="button" className="btn btn--block" onClick={onClose}>
              閉じる
            </button>
          </>
        ) : (
          <>
            <button
              type="submit"
              form="participant-sheet-form"
              className="btn btn--primary btn--block"
              disabled={busy || !canSave}
            >
              {busy ? "保存しています…" : "保存する"}
            </button>
            {!creating && onDelete && rowId && (
              <button
                type="button"
                className="btn btn--danger btn--block"
                disabled={busy}
                onClick={() => void onDelete(rowId)}
              >
                名簿から削除
              </button>
            )}
          </>
        )
      }
    >
      {deletedRow ? (
        <p className="dialog__body">{deletedRow.name} を名簿から削除しました。</p>
      ) : (
        <>
          <p className="dialog__body">
            {row === null
              ? "名簿に載せたい人を追加します。"
              : waitlisted
                ? `参加要望（待ち ${row.waitlistPosition ?? "—"}番目）。出欠を「${rsvpStatusLabel("ATTENDING")}」にすると席を確保します。`
                : `いまは${rsvpStatusLabel(row.status)}。申込後に変わったことがあれば、ここで直します。`}
          </p>

          {/* 集金は保存フォームの外に置く。押した瞬間に記録し、出欠・人数・プランは送らない。
              追加では出さない（まだ名簿に無い行の集金は記録できない）。
              上余白だけ `form--spaced`（1.25rem）を借りる。 */}
          {!creating && (
            <div className="form--spaced">
              {canCollect ? (
                <>
                  <button
                    type="button"
                    className="btn btn--outline btn--block"
                    disabled={collectionBusy}
                    onClick={() => void toggleCollection()}
                  >
                    {collectionBusy ? "記録しています…" : collectedAt ? "集金を戻す" : "集金済みにする"}
                  </button>
                  {collectedAt && (
                    <p className="help alert__actions">{formatDateTimeJa(collectedAt)} に集金</p>
                  )}
                </>
              ) : (
                <p className="help">出席のときに記録できます。</p>
              )}
              {collectionError && <p className="field-error alert__actions">{collectionError}</p>}
            </div>
          )}

          {/* 本文だけが送れるよう、入力は form で包む（`.modal--sheet .dialog > form` が送る側）。 */}
          <form
            id="participant-sheet-form"
            className="form form--spaced"
            onSubmit={(event) => {
              event.preventDefault();
              save(status);
            }}
          >
            <Field label="名前" htmlFor="participant-sheet-name">
              <input
                id="participant-sheet-name"
                className="input"
                maxLength={RSVP_NAME_MAX}
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </Field>

            <Field label="出欠" htmlFor="participant-sheet-status">
              <select
                id="participant-sheet-status"
                className="select"
                value={status}
                onChange={(event) => setStatus(event.target.value as RsvpStatus)}
              >
                <option value="ATTENDING">{rsvpStatusLabel("ATTENDING")}</option>
                <option value="WAITLISTED">{rsvpStatusLabel("WAITLISTED")}</option>
                <option value="DECLINED">{rsvpStatusLabel("DECLINED")}</option>
              </select>
            </Field>

            {!attending && (
              <p className="help">
                欠席と参加要望は席を取りません。出席に戻すと、人数と日時を入れられます。
              </p>
            )}

            {attending && (
              <>
                <Field label="性別" htmlFor="participant-sheet-gender">
                  <select
                    id="participant-sheet-gender"
                    className="select"
                    value={gender}
                    onChange={(event) => pickGender(event.target.value as Gender | "")}
                  >
                    <option value="">未設定</option>
                    <option value="MALE">{GENDER_LABELS.MALE}</option>
                    <option value="FEMALE">{GENDER_LABELS.FEMALE}</option>
                  </select>
                </Field>

                <Field label="人数" htmlFor="participant-sheet-party" help="自分を含めた人数です。">
                  <input
                    id="participant-sheet-party"
                    type="number"
                    inputMode="numeric"
                    min={RSVP_PARTY_SIZE_MIN}
                    max={RSVP_PARTY_SIZE_MAX}
                    className="input"
                    value={partySize}
                    onChange={(event) => setPartySize(event.target.value)}
                    onBlur={() => setPartySize(String(clampRsvpPartySize(partySize)))}
                  />
                </Field>

                {overCapacity && (
                  <p className="help">定員に達しています。参加要望で追加できます。</p>
                )}

                {schedules.length > 0 && (
                  <fieldset className="field">
                    <legend className="label">日時</legend>
                    <div className="roster__schedule-edit">
                      {schedules.map((schedule) => (
                        <label key={schedule.id} className="check">
                          <input
                            type="checkbox"
                            checked={scheduleIds.includes(schedule.id)}
                            onChange={(event) =>
                              setScheduleIds((current) =>
                                event.target.checked
                                  ? [...current, schedule.id]
                                  : current.filter((id) => id !== schedule.id),
                              )
                            }
                          />
                          <span>
                            {formatDateWithWeekdayJa(schedule.eventDate)} {schedule.eventTime}
                          </span>
                        </label>
                      ))}
                    </div>
                  </fieldset>
                )}

                <Field
                  label="料金プラン"
                  htmlFor="participant-sheet-plan"
                  help={pricePlans.length === 0 ? "このイベントには料金プランがありません。" : undefined}
                >
                  <select
                    id="participant-sheet-plan"
                    className="select"
                    value={pricePlanId}
                    disabled={allowedPlans.length === 0}
                    onChange={(event) => setPricePlanId(event.target.value)}
                  >
                    {allowedPlans.map((plan) => (
                      <option key={plan.id} value={plan.id}>
                        {plan.audience === "ANY" ? "" : `${PRICE_AUDIENCE_LABELS[plan.audience]} `}
                        {plan.name} {plan.price}
                      </option>
                    ))}
                  </select>
                </Field>
              </>
            )}

            <Field label="コメント" htmlFor="participant-sheet-comment">
              <input
                id="participant-sheet-comment"
                className="input"
                maxLength={RSVP_COMMENT_MAX}
                value={comment}
                onChange={(event) => setComment(event.target.value)}
              />
            </Field>
          </form>
        </>
      )}
    </Dialog>
  );
}
