"use client";

import type { ReactNode } from "react";
import { useState } from "react";
import { composeEventTime, composeLocation, composePriceText } from "@/lib/serializers";
import type {
  EventFormValues,
  PriceAudience,
  RainPolicy,
} from "@/modules/events/types";
import {
  createPricePlanDraft,
  createScheduleDraft,
  MAX_EVENT_OPTIONS,
  pricingModeOf,
  PRICE_AUDIENCE_LABELS,
  RAIN_POLICY_LABELS,
  STATUS_LABELS,
  withCommonPricing,
  withGenderPricing,
} from "@/modules/events/types";
import { PostalCodeField } from "@/modules/events/components/PostalCodeField";

const AUDIENCES: PriceAudience[] = ["ANY", "MALE", "FEMALE"];

interface EventFormProps {
  value: EventFormValues;
  onChange: (value: EventFormValues) => void;
  onSubmit: () => void;
  submitting: boolean;
  disabled?: boolean;
  submitLabel: string;
  showStatus?: boolean;
  /** 出席者がいるため、共通／男女別の切り替えを止める。 */
  pricingModeLocked?: boolean;
  flyerSlot?: ReactNode;
}

const RAIN_POLICIES = Object.keys(RAIN_POLICY_LABELS) as RainPolicy[];

export function EventForm({
  value,
  onChange,
  onSubmit,
  submitting,
  disabled = false,
  submitLabel,
  showStatus = false,
  pricingModeLocked = false,
  flyerSlot,
}: EventFormProps) {
  const locked = disabled || submitting;
  const [confirmCommonOpen, setConfirmCommonOpen] = useState(false);
  const set = <K extends keyof EventFormValues>(key: K, next: EventFormValues[K]) => {
    onChange({ ...value, [key]: next });
  };

  const hasStructuredAddress = Boolean(
    value.postalCode ||
      value.prefecture ||
      value.city ||
      value.town ||
      value.addressLine ||
      value.building,
  );
  const locationPreview = composeLocation(value);

  const pricingMode = pricingModeOf(value.pricePlans);
  const genderLocked = locked || pricingModeLocked;

  const addPlan = () => {
    // 男女別モードでは新しいプランも男性用・女性用のペアで足す。
    if (pricingMode === "GENDER") {
      if (value.pricePlans.length + 2 > MAX_EVENT_OPTIONS) return;
      set("pricePlans", [
        ...value.pricePlans,
        createPricePlanDraft({ audience: "MALE" }),
        createPricePlanDraft({ audience: "FEMALE" }),
      ]);
      return;
    }
    if (value.pricePlans.length >= MAX_EVENT_OPTIONS) return;
    set("pricePlans", [...value.pricePlans, createPricePlanDraft()]);
  };

  return (
    <form
      className="form"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <div className="field">
        <label className="label">
          催しの名前 <span className="req">*</span>
        </label>
        <input
          required
          maxLength={100}
          disabled={locked}
          value={value.title}
          onChange={(event) => set("title", event.target.value)}
          className="input"
        />
      </div>
      <fieldset className="field" disabled={locked}>
        <legend className="label">
          開催日時 <span className="req">*</span>
        </legend>
        <div className="repeat-block">
          {value.schedules.map((row, index) => {
            const overnight = Boolean(row.startTime && row.endTime && row.endTime < row.startTime);
            const preview = composeEventTime(row.startTime, row.endTime);
            return (
              <div key={row.key} className="repeat-row repeat-row--schedule">
                <div className="field">
                  <label className="label" htmlFor={`schedule-date-${row.key}`}>
                    開催日
                  </label>
                  <input
                    id={`schedule-date-${row.key}`}
                    required
                    type="date"
                    value={row.eventDate}
                    onChange={(event) => {
                      const schedules = value.schedules.map((item, itemIndex) =>
                        itemIndex === index ? { ...item, eventDate: event.target.value } : item,
                      );
                      set("schedules", schedules);
                    }}
                    className="input"
                  />
                </div>
                <div className="field">
                  <label className="label" htmlFor={`schedule-start-${row.key}`}>
                    開始
                  </label>
                  <input
                    id={`schedule-start-${row.key}`}
                    required
                    type="time"
                    step={60}
                    value={row.startTime}
                    onChange={(event) => {
                      const schedules = value.schedules.map((item, itemIndex) =>
                        itemIndex === index ? { ...item, startTime: event.target.value } : item,
                      );
                      set("schedules", schedules);
                    }}
                    className="input"
                  />
                </div>
                <div className="field">
                  <label className="label" htmlFor={`schedule-end-${row.key}`}>
                    終了
                  </label>
                  <input
                    id={`schedule-end-${row.key}`}
                    required
                    type="time"
                    step={60}
                    value={row.endTime}
                    onChange={(event) => {
                      const schedules = value.schedules.map((item, itemIndex) =>
                        itemIndex === index ? { ...item, endTime: event.target.value } : item,
                      );
                      set("schedules", schedules);
                    }}
                    className="input"
                  />
                </div>
                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  disabled={value.schedules.length <= 1}
                  onClick={() => set("schedules", value.schedules.filter((item) => item.key !== row.key))}
                >
                  削除
                </button>
                {(preview || overnight) && (
                  <p className="help repeat-row__note">
                    {preview}
                    {overnight ? "（終了が開始より前なので翌日として扱います）" : ""}
                  </p>
                )}
              </div>
            );
          })}
          <button
            type="button"
            className="btn btn--outline btn--sm"
            disabled={value.schedules.length >= MAX_EVENT_OPTIONS}
            onClick={() => set("schedules", [...value.schedules, createScheduleDraft()])}
          >
            日時を追加
          </button>
          <p className="help">
            開始と終了は両方必須です。1件以上、{MAX_EVENT_OPTIONS}件まで。参加者は出席するときに1つ選びます。
          </p>
        </div>
      </fieldset>
      <fieldset className="field" disabled={locked}>
        <legend className="label">
          費用プラン <span className="req">*</span>
        </legend>
        <div className="repeat-block">
          <label className="check">
            <input
              type="checkbox"
              checked={pricingMode === "GENDER"}
              disabled={genderLocked}
              onChange={(event) => {
                if (event.target.checked) {
                  set("pricePlans", withGenderPricing(value.pricePlans));
                  return;
                }
                // 女性用の行を消すと、選んでいた参加者のプランが外れるため確認する。
                setConfirmCommonOpen(true);
              }}
            />
            男女別の費用を設定する
          </label>
          {pricingModeLocked ? (
            <p className="help">
              出席者がいるため、共通料金と男女別料金の切り替えはできません。金額・プラン名・補足は変更できます。
            </p>
          ) : pricingMode === "COMMON" ? (
            <p className="help">
              チェックを入れると、各プランを男性用・女性用に分けて金額を設定できます。1プランが2件として数えられ、合計{MAX_EVENT_OPTIONS}件までです。
            </p>
          ) : (
            <p className="help">
              男性用・女性用で1組です。1プランが2件として数えられ、合計{MAX_EVENT_OPTIONS}件までです。
            </p>
          )}
          {value.pricePlans.map((row, index) => (
            <div
              key={row.key}
              className={`repeat-row ${pricingMode === "GENDER" ? "repeat-row--plan" : "repeat-row--plan-common"}`}
            >
              {pricingMode === "GENDER" && (
                <div className="field">
                  <label className="label" htmlFor={`plan-audience-${row.key}`}>
                    対象
                  </label>
                  <select
                    id={`plan-audience-${row.key}`}
                    value={row.audience}
                    onChange={(event) => {
                      const pricePlans = value.pricePlans.map((item, itemIndex) =>
                        itemIndex === index
                          ? { ...item, audience: event.target.value as PriceAudience }
                          : item,
                      );
                      set("pricePlans", pricePlans);
                    }}
                    className="select"
                  >
                    {AUDIENCES.map((audience) => (
                      <option key={audience} value={audience}>
                        {PRICE_AUDIENCE_LABELS[audience]}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <div className="field">
                <label className="label" htmlFor={`plan-name-${row.key}`}>
                  プラン名
                </label>
                <input
                  id={`plan-name-${row.key}`}
                  required
                  maxLength={50}
                  value={row.name}
                  onChange={(event) => {
                    const pricePlans = value.pricePlans.map((item, itemIndex) =>
                      itemIndex === index ? { ...item, name: event.target.value } : item,
                    );
                    set("pricePlans", pricePlans);
                  }}
                  placeholder="一般"
                  className="input"
                />
              </div>
              <div className="field">
                <label className="label" htmlFor={`plan-amount-${row.key}`}>
                  金額（円）
                </label>
                <input
                  id={`plan-amount-${row.key}`}
                  required
                  type="number"
                  inputMode="numeric"
                  min={0}
                  max={9999999}
                  step={1}
                  value={row.amount}
                  onChange={(event) => {
                    const pricePlans = value.pricePlans.map((item, itemIndex) =>
                      itemIndex === index ? { ...item, amount: event.target.value } : item,
                    );
                    set("pricePlans", pricePlans);
                  }}
                  placeholder="3000"
                  className="input"
                />
              </div>
              <div className="field">
                <label className="label" htmlFor={`plan-note-${row.key}`}>
                  補足（任意）
                </label>
                <input
                  id={`plan-note-${row.key}`}
                  maxLength={100}
                  value={row.note}
                  onChange={(event) => {
                    const pricePlans = value.pricePlans.map((item, itemIndex) =>
                      itemIndex === index ? { ...item, note: event.target.value } : item,
                    );
                    set("pricePlans", pricePlans);
                  }}
                  placeholder="1ドリンク付"
                  className="input"
                />
              </div>
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                disabled={value.pricePlans.length <= 1}
                onClick={() => set("pricePlans", value.pricePlans.filter((item) => item.key !== row.key))}
              >
                削除
              </button>
              <p className="help repeat-row__note">
                {row.amount === "" ? "金額を入れてください" : composePriceText({ amount: Number(row.amount), note: row.note })}
              </p>
            </div>
          ))}
          <div className="btn-row">
            <button
              type="button"
              className="btn btn--outline btn--sm"
              disabled={
                pricingMode === "GENDER"
                  ? value.pricePlans.length + 2 > MAX_EVENT_OPTIONS
                  : value.pricePlans.length >= MAX_EVENT_OPTIONS
              }
              onClick={addPlan}
            >
              プランを追加
            </button>
          </div>
          <p className="help">
            金額は整数の円です。0円は「無料」と表示します。
            {pricingMode === "GENDER"
              ? "参加者は自分の性別に合うプラン（対象「男性」または「女性」、および「共通」）だけを選べます。"
              : "参加者は全員この金額から選びます。"}
          </p>
        </div>
      </fieldset>
      <fieldset className="field" disabled={locked}>
        <legend className="label">
          開催場所 <span className="req">*</span>
        </legend>
        <div className="field">
          <label className="label" htmlFor="event-venue-name">
            会場名
          </label>
          <input
            id="event-venue-name"
            maxLength={150}
            value={value.venueName}
            onChange={(event) => set("venueName", event.target.value)}
            placeholder="○○ホール"
            className="input"
          />
        </div>
        <PostalCodeField
          value={value.postalCode}
          disabled={locked}
          onChange={(postalCode) => set("postalCode", postalCode)}
          onSelect={(result) => {
            onChange({
              ...value,
              postalCode: result.postalCode,
              prefecture: result.prefecture,
              city: result.city,
              town: result.town,
            });
          }}
        />
        <div className="repeat-row repeat-row--address">
          <div className="field">
            <label className="label" htmlFor="event-prefecture">
              都道府県
            </label>
            <input
              id="event-prefecture"
              maxLength={20}
              value={value.prefecture}
              onChange={(event) => set("prefecture", event.target.value)}
              placeholder="東京都"
              className="input"
            />
          </div>
          <div className="field">
            <label className="label" htmlFor="event-city">
              市区町村
            </label>
            <input
              id="event-city"
              maxLength={100}
              value={value.city}
              onChange={(event) => set("city", event.target.value)}
              placeholder="渋谷区"
              className="input"
            />
          </div>
        </div>
        <div className="repeat-row repeat-row--address">
          <div className="field">
            <label className="label" htmlFor="event-town">
              町域
            </label>
            <input
              id="event-town"
              maxLength={100}
              value={value.town}
              onChange={(event) => set("town", event.target.value)}
              placeholder="神宮前"
              className="input"
            />
          </div>
          <div className="field">
            <label className="label" htmlFor="event-address-line">
              番地
            </label>
            <input
              id="event-address-line"
              maxLength={200}
              value={value.addressLine}
              onChange={(event) => set("addressLine", event.target.value)}
              placeholder="1-2-3"
              className="input"
            />
          </div>
        </div>
        <div className="field">
          <label className="label" htmlFor="event-building">
            建物名・階数（任意）
          </label>
          <input
            id="event-building"
            maxLength={150}
            value={value.building}
            onChange={(event) => set("building", event.target.value)}
            placeholder="○○ビル3F"
            className="input"
          />
        </div>
        {locationPreview && <p className="help">公開ページの表示: {locationPreview}</p>}
        {!hasStructuredAddress && !value.venueName && value.location ? (
          <p className="alert alert--warning">
            このイベントは旧形式の場所「{value.location}」で登録されています。郵便番号から住所を入れると表示が新しくなります。空のまま保存すると旧形式のまま残ります。
          </p>
        ) : (
          <p className="help">
            郵便番号から入れると都道府県・市区町村・町域が自動で入ります。オンライン開催など場所が決まっていないときは、会場名だけでも保存できます。
          </p>
        )}
      </fieldset>
      <div className="field">
        <label className="label">雨天時の方針</label>
        <select
          disabled={locked}
          value={value.rainPolicy}
          onChange={(event) => set("rainPolicy", event.target.value as RainPolicy)}
          className="select"
        >
          {RAIN_POLICIES.map((policy) => (
            <option key={policy} value={policy}>
              {RAIN_POLICY_LABELS[policy]}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label className="label">定員（空欄で無制限）</label>
        <input
          type="number"
          min={1}
          disabled={locked}
          value={value.capacity ?? ""}
          onChange={(event) => {
            const raw = event.target.value;
            set("capacity", raw === "" ? null : Number(raw));
          }}
          className="input"
        />
      </div>
      <div className="field">
        <label className="label" htmlFor="rsvp-deadline">
          申し込み期限
        </label>
        <input
          id="rsvp-deadline"
          type="datetime-local"
          step={60}
          disabled={locked}
          value={value.rsvpDeadline}
          onChange={(event) => set("rsvpDeadline", event.target.value)}
          className="input"
        />
        <p className="help">
          空欄なら期限はありません。この日時（日本時間）になると、新しい申し込みと回答の変更を止めます。取消はできます。告知URLは開いたままです。
        </p>
      </div>
      {flyerSlot}
      {showStatus && (
        <div className="field">
          <label className="label" htmlFor="event-status">
            公開状態
          </label>
          {value.status === "DRAFT" ? (
            <>
              <select
                id="event-status"
                disabled={locked}
                value={value.status}
                onChange={(event) => set("status", event.target.value as "DRAFT" | "PUBLISHED")}
                className="select"
              >
                <option value="DRAFT">{STATUS_LABELS.DRAFT}</option>
                <option value="PUBLISHED">{STATUS_LABELS.PUBLISHED}</option>
              </select>
              <p className="help">下書きのままでは告知URLを開けません。公開すると出欠を受け付けます。</p>
            </>
          ) : (
            <>
              <p>{value.status ? STATUS_LABELS[value.status] : ""}</p>
              <p className="help">
                公開状態はここでは変えられません。受付を止めるときは主催一覧の「削除・停止」から行います。
              </p>
            </>
          )}
        </div>
      )}
      <button type="submit" disabled={locked} className="btn btn--primary btn--block">
        {submitting ? "送信中..." : submitLabel}
      </button>
      {confirmCommonOpen && (
        <div className="modal" style={{ display: "flex" }}>
          <button
            type="button"
            className="modal__backdrop"
            aria-label="閉じる"
            onClick={() => setConfirmCommonOpen(false)}
          />
          <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="pricing-mode-title">
            <h3 id="pricing-mode-title" className="dialog__title">
              共通料金に戻しますか？
            </h3>
            <p className="dialog__body">
              男性用の料金を共通の料金に戻し、女性用の料金を削除します。女性用の料金を選んでいた参加者は、保存後に費用プランが未設定になります。名簿から選び直してください。
            </p>
            <div className="dialog__actions">
              <button
                type="button"
                className="btn btn--danger btn--block"
                onClick={() => {
                  set("pricePlans", withCommonPricing(value.pricePlans));
                  setConfirmCommonOpen(false);
                }}
              >
                共通料金に戻す
              </button>
              <button
                type="button"
                className="btn btn--ghost btn--block"
                onClick={() => setConfirmCommonOpen(false)}
              >
                やめる
              </button>
            </div>
          </div>
        </div>
      )}
    </form>
  );
}