"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useRsvp } from "@/modules/attendance/hooks/useRsvp";
import {
  GENDER_LABELS,
  PRICE_AUDIENCE_LABELS,
  type EventPricePlanOption,
  type EventScheduleOption,
  type Gender,
  type MyRsvp,
  type RsvpStatus,
} from "@/modules/events/types";

interface DynamicRsvpBoxProps {
  eventId: string;
  schedules: EventScheduleOption[];
  pricePlans: EventPricePlanOption[];
  initialRsvp: MyRsvp | null;
  closed: boolean;
  closedMessage?: string;
  onCountChange: (count: number) => void;
}

const GENDERS: Gender[] = ["MALE", "FEMALE"];

export function DynamicRsvpBox({
  eventId,
  schedules,
  pricePlans,
  initialRsvp,
  closed,
  closedMessage = "このイベントは出欠を受け付けていません。",
  onCountChange,
}: DynamicRsvpBoxProps) {
  const { myRsvp, submit, cancel, isSubmitting, error } = useRsvp(eventId, initialRsvp);
  const [name, setName] = useState(initialRsvp?.name ?? "");
  const [status, setStatus] = useState<RsvpStatus>(initialRsvp?.status ?? "ATTENDING");
  const [gender, setGender] = useState<Gender | "">(initialRsvp?.gender ?? "");
  const [comment, setComment] = useState(initialRsvp?.comment ?? "");
  const [scheduleId, setScheduleId] = useState(
    schedules.some((row) => row.id === initialRsvp?.scheduleId) ? (initialRsvp?.scheduleId ?? "") : (schedules[0]?.id ?? ""),
  );
  const [pricePlanId, setPricePlanId] = useState(initialRsvp?.pricePlanId ?? "");
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
  }, [initialRsvp, schedules]);

  /** 性別に合うプランだけ選べる。未選択のうちは共通プランだけ出す。 */
  const availablePlans = useMemo(() => {
    if (!gender) return pricePlans.filter((row) => row.audience === "ANY");
    return pricePlans.filter((row) => row.audience === "ANY" || row.audience === gender);
  }, [gender, pricePlans]);

  const selectedPlanId = availablePlans.some((row) => row.id === pricePlanId)
    ? pricePlanId
    : (availablePlans[0]?.id ?? "");

  const hasOnlyCommonPlans = pricePlans.every((row) => row.audience === "ANY");

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const result = await submit({
      name: name.trim(),
      status,
      gender: gender || undefined,
      comment: comment.trim(),
      scheduleId,
      pricePlanId: selectedPlanId,
    });
    if (typeof result.attendingCount === "number") onCountChange(result.attendingCount);
    setSaved(true);
  };

  const onCancel = async () => {
    const result = await cancel();
    if (typeof result.attendingCount === "number") onCountChange(result.attendingCount);
    setName("");
    setComment("");
    setStatus("ATTENDING");
    setGender("");
    setScheduleId(schedules[0]?.id ?? "");
    setPricePlanId("");
    setSaved(false);
  };

  return (
    <section id="rsvp" className="card card--padded">
      <p className="eyebrow">出欠</p>
      <h2 className="panel__title">{myRsvp ? "回答済み・変更できます" : "3秒で出欠を回答"}</h2>
      <p className="panel__note">アカウントは不要です。この端末に回答を覚えておきます。</p>
      <form onSubmit={onSubmit} className="form form--spaced">
        <fieldset className="field">
          <legend className="label">出欠</legend>
          <div className="choice-group" style={{ gridTemplateColumns: "1fr 1fr" }}>
            <label className="choice choice--attending">
              <input
                type="radio"
                name="rsvp"
                checked={status === "ATTENDING"}
                disabled={closed || isSubmitting}
                onChange={() => setStatus("ATTENDING")}
              />
              出席
            </label>
            <label className="choice choice--declined">
              <input
                type="radio"
                name="rsvp"
                checked={status === "DECLINED"}
                disabled={closed || isSubmitting}
                onChange={() => setStatus("DECLINED")}
              />
              欠席
            </label>
          </div>
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
                        disabled={closed || isSubmitting}
                        onChange={() => setGender(value)}
                      />
                      {GENDER_LABELS[value]}
                    </label>
                  ))}
                </div>
                <p className="help">性別によって選べる費用プランが変わります。</p>
              </fieldset>
            )}
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
                      disabled={closed || isSubmitting}
                      onChange={() => setScheduleId(row.id)}
                    />
                    {row.eventDate} {row.eventTime}
                  </label>
                ))}
              </div>
            </fieldset>
            <fieldset className="field">
              <legend className="label">費用プラン</legend>
              {availablePlans.length === 0 ? (
                <p className="alert alert--warning">
                  {gender
                    ? "この性別で選べる費用プランがありません。幹事に確認してください。"
                    : "性別を選ぶと費用プランが表示されます。"}
                </p>
              ) : (
                <div className="choice-group choice-group--stack">
                  {availablePlans.map((row) => (
                    <label key={row.id} className="choice choice--left">
                      <input
                        type="radio"
                        name="price-plan"
                        required
                        checked={selectedPlanId === row.id}
                        disabled={closed || isSubmitting}
                        onChange={() => setPricePlanId(row.id)}
                      />
                      {row.audience === "ANY" ? "" : `${PRICE_AUDIENCE_LABELS[row.audience]} `}
                      {row.name} {row.price}
                    </label>
                  ))}
                </div>
              )}
            </fieldset>
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
            disabled={closed || isSubmitting}
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
            disabled={closed || isSubmitting}
            onChange={(event) => setComment(event.target.value)}
            rows={3}
            className="textarea"
            placeholder="楽しみにしています"
          />
        </div>
        {error && <p className="alert alert--error">{error}</p>}
        {saved && !error && <p className="alert alert--success">回答を保存しました。</p>}
        <button
          type="submit"
          disabled={closed || isSubmitting || (status === "ATTENDING" && availablePlans.length === 0)}
          className="btn btn--primary btn--block"
        >
          {isSubmitting ? "送信中..." : myRsvp ? "回答を更新する" : "この内容で回答を送信"}
        </button>
        {myRsvp && (
          <button type="button" onClick={() => void onCancel()} disabled={isSubmitting} className="btn btn--ghost btn--block">
            回答を取り消す
          </button>
        )}
        {closed && <p className="alert alert--warning">{closedMessage}</p>}
      </form>
    </section>
  );
}
