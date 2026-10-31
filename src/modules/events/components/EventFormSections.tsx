"use client";

import { useState } from "react";
import { composeDiscountText, composeEventTime, composeLocation, composePriceText } from "@/lib/serializers";
import type { DiscountDraft, EventFormValues, PricePlanDraft, RainPolicy } from "@/modules/events/types";
import {
  createDiscountDraft,
  createPricePlanDraft,
  createScheduleDraft,
  groupNamesDiffer,
  groupPricePlanPairs,
  MAX_EVENT_OPTIONS,
  pricingModeOf,
  PRICE_AUDIENCE_LABELS,
  RAIN_POLICY_LABELS,
  STATUS_LABELS,
  withCommonPricing,
  withGenderPricing,
  withGroupName,
} from "@/modules/events/types";
import {
  CAPACITY_PRESETS,
  capacityForSelection,
  capacityFromCustomInput,
  type CapacitySelection,
} from "@/modules/events/lib/capacity";
import { PostalCodeField } from "@/modules/events/components/PostalCodeField";
import { VenueSelectModal } from "@/modules/events/components/VenueSelectModal";
import { Alert, Dialog, Field, ThemePicker } from "@/components/ui";

/**
 * 作成画面（ステップ）と編集画面（一括）で同じ入力欄を使うための共通の型。
 * セクションは値と変更関数だけを受け取り、送信やステップの進行は知らない。
 */
export interface EventSectionProps {
  value: EventFormValues;
  onChange: (value: EventFormValues) => void;
  disabled?: boolean;
}

const RAIN_POLICIES = Object.keys(RAIN_POLICY_LABELS) as RainPolicy[];

/** イベント名・主催者名・開催日時。 */
export function BasicSection({
  value,
  onChange,
  disabled = false,
  showOrganizerName = false,
}: EventSectionProps & { showOrganizerName?: boolean }) {
  const set = <K extends keyof EventFormValues>(key: K, next: EventFormValues[K]) => {
    onChange({ ...value, [key]: next });
  };

  return (
    <>
      <Field label="イベント名" htmlFor="event-title">
        <input
          id="event-title"
          required
          maxLength={100}
          disabled={disabled}
          value={value.title}
          onChange={(event) => set("title", event.target.value)}
          placeholder="例: 秋の芋煮会"
          className="input"
        />
      </Field>
      {showOrganizerName && (
        <Field label="主催者名（公開されます）" htmlFor="event-organizer-name">
          <input
            id="event-organizer-name"
            maxLength={50}
            disabled={disabled}
            value={value.organizerDisplayName}
            onChange={(event) => set("organizerDisplayName", event.target.value)}
            placeholder="例: 山田 太郎"
            className="input"
          />
          <p className="help">
            公開ページに出る名前です。空欄なら「主催者」と表示されます。
          </p>
        </Field>
      )}
      <fieldset className="field" disabled={disabled}>
        <legend className="label">開催日時</legend>
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
                    {overnight ? "（終了が開始より前なので翌日扱い）" : ""}
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
            開始と終了は必須。{MAX_EVENT_OPTIONS}件まで。参加者は1つ選びます。
          </p>
        </div>
      </fieldset>
    </>
  );
}

/** 費用プラン。共通料金と男女別の切り替えを含む。 */
export function PricePlansSection({
  value,
  onChange,
  disabled = false,
  pricingModeLocked = false,
}: EventSectionProps & {
  /** 出席者がいるため、共通／男女別の切り替えを止める。 */
  pricingModeLocked?: boolean;
}) {
  const [confirmCommonOpen, setConfirmCommonOpen] = useState(false);
  const set = <K extends keyof EventFormValues>(key: K, next: EventFormValues[K]) => {
    onChange({ ...value, [key]: next });
  };

  const pricingMode = pricingModeOf(value.pricePlans);
  const genderLocked = disabled || pricingModeLocked;
  // 男女別では男性用・女性用が1組なので、プラン名の入力も削除も組単位で行う。
  const planGroups = groupPricePlanPairs(value.pricePlans);
  const canRemovePlan = planGroups.length > 1;
  const hasLegacyCommonPlan =
    pricingMode === "GENDER" && value.pricePlans.some((row) => row.audience === "ANY");

  const updatePlan = (rowKey: string, patch: Partial<PricePlanDraft>) => {
    set(
      "pricePlans",
      value.pricePlans.map((row) => (row.key === rowKey ? { ...row, ...patch } : row)),
    );
  };

  /** 共通料金のプラン名。男女別では組の見出しに1つだけ出すので、行の中では使わない。 */
  const planNameField = (row: PricePlanDraft) => (
    <div className="field">
      <label className="label" htmlFor={`plan-name-${row.key}`}>
        プラン名
      </label>
      <input
        id={`plan-name-${row.key}`}
        required
        maxLength={50}
        value={row.name}
        onChange={(event) => updatePlan(row.key, { name: event.target.value })}
        placeholder="一般"
        className="input"
      />
    </div>
  );

  /** 金額と補足は行ごとに持つ。男女別でも金額は分けたいので、組の中の行に残す。 */
  const planAmountAndNoteFields = (row: PricePlanDraft) => (
    <>
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
          onChange={(event) => updatePlan(row.key, { amount: event.target.value })}
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
          onChange={(event) => updatePlan(row.key, { note: event.target.value })}
          placeholder="1ドリンク付"
          className="input"
        />
      </div>
      <p className="help repeat-row__note">
        {row.amount === "" ? "金額を入れてください" : composePriceText({ amount: Number(row.amount), note: row.note })}
      </p>
    </>
  );

  /** 男女別では対象を選ばせない。固定表示だけを出す。 */
  const planAudienceField = (row: PricePlanDraft) => (
    <div className="field">
      <span className="label">対象</span>
      <p className="price-audience">{PRICE_AUDIENCE_LABELS[row.audience]}</p>
    </div>
  );

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

  const removePlan = (rowKey: string) => {
    const group = planGroups.find((rows) => rows.some((item) => item.key === rowKey));
    const removing = new Set((group ?? []).map((item) => item.key));
    const next = value.pricePlans.filter((item) => !removing.has(item.key));
    // 費用プランは1件以上必要なので、最後の1組は消さない。
    if (next.length === 0) return;
    set("pricePlans", next);
  };

  return (
    <>
      <fieldset className="field" disabled={disabled}>
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
              出席者がいるため切り替えできません。金額とプラン名は変えられます。
            </p>
          ) : pricingMode === "COMMON" ? (
            <p className="help">
              男性用・女性用に分けて金額を決められます。1プランが2件で、合計{MAX_EVENT_OPTIONS}件まで。
            </p>
          ) : (
            <p className="help">
              プラン名は組で共通、金額は行ごとです。追加も削除も組単位。合計{MAX_EVENT_OPTIONS}件まで。
            </p>
          )}
          {hasLegacyCommonPlan && (
            <Alert tone="warning">
              対象が「共通」のまま残っている料金があります。対象は画面から変えられません。
              {pricingModeLocked
                ? "出席者がいるため共通料金に戻せません。名簿でプランを選び直してから戻してください。"
                : "チェックを外して戻し、入れ直すと組に揃えられます。"}
            </Alert>
          )}
          {pricingMode === "GENDER"
            ? planGroups.map((group) => {
                // 1組＝1プランなので、プラン名は組の見出しに1つだけ置く。
                const head = group[0];
                return (
                  <div key={head.key} className="price-group">
                    <div className="price-group__head">
                      <div className="field">
                        <label className="label" htmlFor={`plan-name-${head.key}`}>
                          プラン名
                        </label>
                        <input
                          id={`plan-name-${head.key}`}
                          required
                          maxLength={50}
                          value={head.name}
                          onChange={(event) =>
                            set("pricePlans", withGroupName(value.pricePlans, group, event.target.value))
                          }
                          placeholder="一般"
                          className="input"
                        />
                      </div>
                      <button
                        type="button"
                        className="btn btn--ghost btn--sm"
                        disabled={!canRemovePlan}
                        aria-label="この組を削除"
                        onClick={() => removePlan(head.key)}
                      >
                        組を削除
                      </button>
                    </div>
                    {groupNamesDiffer(group) && (
                      <Alert tone="warning">
                        組の中でプラン名が違います。上の名前に直すと両方へ反映されます。
                      </Alert>
                    )}
                    {group.map((row) => (
                      <div key={row.key} className="repeat-row repeat-row--plan">
                        {planAudienceField(row)}
                        {planAmountAndNoteFields(row)}
                      </div>
                    ))}
                  </div>
                );
              })
            : value.pricePlans.map((row) => (
                <div key={row.key} className="repeat-row repeat-row--plan-common">
                  {planNameField(row)}
                  {planAmountAndNoteFields(row)}
                  <button
                    type="button"
                    className="btn btn--ghost btn--sm"
                    disabled={!canRemovePlan}
                    aria-label="このプランを削除"
                    onClick={() => removePlan(row.key)}
                  >
                    削除
                  </button>
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
              ? "参加者は自分の性別のプランを選びます。"
              : "参加者は全員この金額から選びます。"}
          </p>
        </div>
      </fieldset>
      {confirmCommonOpen && (
        <Dialog
          title="共通料金に戻しますか？"
          titleId="pricing-mode-title"
          onClose={() => setConfirmCommonOpen(false)}
          actions={<><button
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
              </button></>}
        >
          <p className="dialog__body">
              女性用の料金は削除されます。選んでいた参加者は名簿から選び直してください。
            </p>
        </Dialog>
      )}
    </>
  );
}

/**
 * 割引。参加者が申込時にモーダルで選ぶ条件名と値引き額の組。
 * 任意なので 0 件が既定で、0 件なら告知ページに行を出さない。
 * すべての費用プランに適用する（対象プランの指定は持たない）。
 */
export function DiscountSection({ value, onChange, disabled = false }: EventSectionProps) {
  const set = <K extends keyof EventFormValues>(key: K, next: EventFormValues[K]) => {
    onChange({ ...value, [key]: next });
  };

  const updateDiscount = (rowKey: string, patch: Partial<DiscountDraft>) => {
    set(
      "discounts",
      value.discounts.map((row) => (row.key === rowKey ? { ...row, ...patch } : row)),
    );
  };

  const addDiscount = () => {
    if (value.discounts.length >= MAX_EVENT_OPTIONS) return;
    set("discounts", [...value.discounts, createDiscountDraft()]);
  };

  const removeDiscount = (rowKey: string) => {
    set(
      "discounts",
      value.discounts.filter((row) => row.key !== rowKey),
    );
  };

  return (
    <fieldset className="field" disabled={disabled}>
      <legend className="label">割引（任意）</legend>
      <div className="repeat-block">
        <p className="help">
          参加者が申込時に選べる割引です。すべての費用プランから引きます。{MAX_EVENT_OPTIONS}件まで。
        </p>
        {value.discounts.length === 0 ? (
          <p className="help">割引がなければ、このままで大丈夫です。</p>
        ) : (
          value.discounts.map((row) => (
            <div key={row.key} className="repeat-row repeat-row--discount">
              <div className="field">
                <label className="label" htmlFor={`discount-name-${row.key}`}>
                  割引名
                </label>
                <input
                  id={`discount-name-${row.key}`}
                  required
                  maxLength={50}
                  value={row.name}
                  onChange={(event) => updateDiscount(row.key, { name: event.target.value })}
                  placeholder="友達と参加"
                  className="input"
                />
              </div>
              <div className="field">
                <label className="label" htmlFor={`discount-amount-${row.key}`}>
                  値引き額（円）
                </label>
                <input
                  id={`discount-amount-${row.key}`}
                  required
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={9999999}
                  step={1}
                  value={row.amount}
                  onChange={(event) => updateDiscount(row.key, { amount: event.target.value })}
                  placeholder="500"
                  className="input"
                />
              </div>
              <div className="field">
                <label className="label" htmlFor={`discount-note-${row.key}`}>
                  補足（任意）
                </label>
                <input
                  id={`discount-note-${row.key}`}
                  maxLength={100}
                  value={row.note}
                  onChange={(event) => updateDiscount(row.key, { note: event.target.value })}
                  placeholder="2人以上のとき"
                  className="input"
                />
              </div>
              <p className="help repeat-row__note">
                {row.name.trim() === "" || row.amount === ""
                  ? "割引名と値引き額を入れてください"
                  : composeDiscountText({ name: row.name, amount: Number(row.amount), note: row.note })}
              </p>
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                aria-label="この割引を削除"
                onClick={() => removeDiscount(row.key)}
              >
                削除
              </button>
            </div>
          ))
        )}
        <div className="btn-row">
          <button
            type="button"
            className="btn btn--outline btn--sm"
            disabled={value.discounts.length >= MAX_EVENT_OPTIONS}
            onClick={addDiscount}
          >
            割引を追加
          </button>
        </div>
        <p className="help">
          値引き額は1円以上、整数の円です。支払額は0円より下がりません。
        </p>
      </div>
    </fieldset>
  );
}

/** 開催場所と雨天時の方針。 */
export function LocationSection({ value, onChange, disabled = false }: EventSectionProps) {
  const [venuePickerOpen, setVenuePickerOpen] = useState(false);
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

  return (
    <>
      <fieldset className="field" disabled={disabled}>
        <legend className="label">
          開催場所 <span className="req">*</span>
        </legend>
        <Field label="会場名" htmlFor="event-venue-name">
          <input
            id="event-venue-name"
            maxLength={150}
            value={value.venueName}
            onChange={(event) => set("venueName", event.target.value)}
            placeholder="○○ホール"
            className="input"
          />
          <div className="btn-row">
            <button
              type="button"
              className="btn btn--outline btn--sm"
              disabled={disabled}
              onClick={() => setVenuePickerOpen(true)}
            >
              過去の会場から選ぶ
            </button>
          </div>
        </Field>
        <PostalCodeField
          value={value.postalCode}
          disabled={disabled}
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
          <Field label="都道府県" htmlFor="event-prefecture">
            <input
              id="event-prefecture"
              maxLength={20}
              value={value.prefecture}
              onChange={(event) => set("prefecture", event.target.value)}
              placeholder="東京都"
              className="input"
            />
          </Field>
          <Field label="市区町村" htmlFor="event-city">
            <input
              id="event-city"
              maxLength={100}
              value={value.city}
              onChange={(event) => set("city", event.target.value)}
              placeholder="渋谷区"
              className="input"
            />
          </Field>
        </div>
        <div className="repeat-row repeat-row--address">
          <Field label="町域" htmlFor="event-town">
            <input
              id="event-town"
              maxLength={100}
              value={value.town}
              onChange={(event) => set("town", event.target.value)}
              placeholder="神宮前"
              className="input"
            />
          </Field>
          <Field label="番地" htmlFor="event-address-line">
            <input
              id="event-address-line"
              maxLength={200}
              value={value.addressLine}
              onChange={(event) => set("addressLine", event.target.value)}
              placeholder="1-2-3"
              className="input"
            />
          </Field>
        </div>
        <Field label="建物名・階数（任意）" htmlFor="event-building">
          <input
            id="event-building"
            maxLength={150}
            value={value.building}
            onChange={(event) => set("building", event.target.value)}
            placeholder="○○ビル3F"
            className="input"
          />
        </Field>
        {locationPreview && <p className="help">公開ページの表示: {locationPreview}</p>}
        {!hasStructuredAddress && !value.venueName && value.location ? (
          <Alert tone="warning">
            旧形式の場所「{value.location}」で登録されています。郵便番号から住所を入れると新しくなります。
          </Alert>
        ) : (
          <p className="help">
            郵便番号を入れると住所が入ります。会場名だけでも保存できます。
          </p>
        )}
      </fieldset>
      <Field label="雨天時の方針" htmlFor="event-rain-policy">
        <select
          id="event-rain-policy"
          disabled={disabled}
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
      </Field>
      <VenueSelectModal
        isOpen={venuePickerOpen}
        onClose={() => setVenuePickerOpen(false)}
        onSelect={(venue) => {
          // 会場ひとまとまりで入れる。旧・自由入力の location はそのまま残す
          // （構造化住所があるときは送信時に使われない）。
          onChange({
            ...value,
            venueName: venue.venueName ?? "",
            postalCode: venue.postalCode ?? "",
            prefecture: venue.prefecture ?? "",
            city: venue.city ?? "",
            town: venue.town ?? "",
            addressLine: venue.addressLine ?? "",
            building: venue.building ?? "",
          });
        }}
      />
    </>
  );
}

/**
 * 定員と申し込み期限。
 * 定員は決まった人数から選ばせ、51 人以上のときだけ数値入力を出す。
 * 「51以上」を選んだことは保存値からは分からない（空にすると無制限と区別できない）ため、
 * 選択の状態は呼び出し側が持つ。
 */
export function CapacitySection({
  value,
  onChange,
  disabled = false,
  selection,
  onSelectionChange,
}: EventSectionProps & {
  selection: CapacitySelection;
  onSelectionChange: (selection: CapacitySelection) => void;
}) {
  const set = <K extends keyof EventFormValues>(key: K, next: EventFormValues[K]) => {
    onChange({ ...value, [key]: next });
  };

  const handleSelection = (next: CapacitySelection) => {
    onSelectionChange(next);
    set("capacity", capacityForSelection(next, value.capacity));
  };

  return (
    <>
      <Field label="定員" htmlFor="event-capacity">
        <select
          id="event-capacity"
          disabled={disabled}
          value={selection}
          onChange={(event) => handleSelection(event.target.value as CapacitySelection)}
          className="select"
        >
          <option value="">無制限</option>
          {CAPACITY_PRESETS.map((preset) => (
            <option key={preset} value={String(preset)}>
              {preset}名
            </option>
          ))}
          <option value="custom">51以上（数値入力）</option>
        </select>
      </Field>
      {selection === "custom" && (
        <Field label="人数" htmlFor="event-capacity-custom">
          <input
            id="event-capacity-custom"
            type="number"
            inputMode="numeric"
            min={1}
            step={1}
            disabled={disabled}
            value={value.capacity ?? ""}
            onChange={(event) => set("capacity", capacityFromCustomInput(event.target.value))}
            placeholder="120"
            className="input"
          />
          <p className="help">51人以上を入れてください。空欄では次へ進めません。</p>
        </Field>
      )}
      <Field label="対象世代（任意）" htmlFor="event-target-generation">
        <input
          id="event-target-generation"
          maxLength={50}
          disabled={disabled}
          value={value.targetGeneration}
          onChange={(event) => set("targetGeneration", event.target.value)}
          placeholder="20代から40代"
          className="input"
        />
        <p className="help">
          公開ページに「対象」として出ます。チラシの人物表現にも使います。
        </p>
      </Field>
      <Field label="申し込み期限" htmlFor="rsvp-deadline">
        <input
          id="rsvp-deadline"
          type="datetime-local"
          step={60}
          disabled={disabled}
          value={value.rsvpDeadline}
          onChange={(event) => set("rsvpDeadline", event.target.value)}
          className="input"
        />
        <p className="help">
          空欄なら期限なし。この日時から新規受付と回答の変更を止めます。
        </p>
      </Field>
    </>
  );
}

/**
 * 告知ページのテーマ。チラシの手前に置き、選んだ見た目をそのまま確認できるようにする。
 * 選択は保存するまで確定しない（親のフォームが持つ）。
 */
export function ThemeSection({
  value,
  onChange,
  disabled = false,
  onPreview,
}: EventSectionProps & {
  /** ここまでの内容をモーダルで開く導線。渡されたときだけ出す。 */
  onPreview?: () => void;
}) {
  return (
    <>
      <fieldset className="field" disabled={disabled}>
        <legend className="label">イベントページのテーマ</legend>
        <ThemePicker
          name="event-theme"
          value={value.themeId}
          onChange={(themeId) => onChange({ ...value, themeId })}
          variant="compact"
        />
        <p className="help">
          告知ページの配色が変わります。チラシの雰囲気にも反映します。
        </p>
      </fieldset>
      {onPreview && (
        <button type="button" className="btn btn--ghost btn--sm" disabled={disabled} onClick={onPreview}>
          プレビュー
        </button>
      )}
    </>
  );
}

/** 公開状態。編集画面だけが使う。 */
export function StatusSection({ value, onChange, disabled = false }: EventSectionProps) {
  const set = <K extends keyof EventFormValues>(key: K, next: EventFormValues[K]) => {
    onChange({ ...value, [key]: next });
  };

  return (
    <Field label="公開状態" htmlFor="event-status">
      {value.status === "DRAFT" ? (
        <>
          <select
            id="event-status"
            disabled={disabled}
            value={value.status}
            onChange={(event) => set("status", event.target.value as "DRAFT" | "PUBLISHED")}
            className="select"
          >
            <option value="DRAFT">{STATUS_LABELS.DRAFT}</option>
            <option value="PUBLISHED">{STATUS_LABELS.PUBLISHED}</option>
          </select>
          <p className="help">下書きでは告知URLを開けません。公開すると出欠を受け付けます。</p>
        </>
      ) : (
        <>
          <p>{value.status ? STATUS_LABELS[value.status] : ""}</p>
          <p className="help">
            ここでは変えられません。止めるときは主催一覧の「停止」から。
          </p>
        </>
      )}
    </Field>
  );
}

