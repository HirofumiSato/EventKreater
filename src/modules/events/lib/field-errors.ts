/**
 * ステップ入力の欄ごとのエラー。保存・プレビューの直前に作り、各入力欄の下に出す。
 *
 * `isStepComplete` と同じ条件を「どの欄が足りないか」まで分けて返す。
 * キーは `EventFormSections` の入力欄の id。`EventStepForm` はこの id から
 * 開くステップを決め、その欄へスクロールしてフォーカスする。片方だけ id を変えると
 * メッセージが出なくなるので、欄を足すときは両方そろえる。
 */
import type { CapacitySelection } from "@/modules/events/lib/capacity";
import { isCapacityStepComplete, type EventStepKey } from "@/modules/events/lib/steps";
import { EVENT_SUMMARY_MAX_LENGTH, summaryTextLength } from "@/modules/events/lib/summary";
import type { EventFormValues } from "@/modules/events/types";

/** 入力欄の id → その下に出すエラー文。 */
export type EventFieldErrors = Record<string, string>;

/**
 * 必須の欄のうち、まだ埋まっていないものだけを返す。すべて埋まっていれば空。
 * 概要は任意だが、上限を超えたままでは保存できないので同じ仕組みに載せる。
 */
export function eventFieldErrors(
  value: EventFormValues,
  options: { capacitySelection: CapacitySelection },
): EventFieldErrors {
  const errors: EventFieldErrors = {};

  if (summaryTextLength(value.summary) > EVENT_SUMMARY_MAX_LENGTH) {
    errors["event-summary"] = `イベント概要は${EVENT_SUMMARY_MAX_LENGTH}文字以内にしてください。`;
  }
  if (value.title.trim() === "") {
    errors["event-title"] = "イベント名を入れてください。";
  }
  for (const row of value.schedules) {
    if (!row.eventDate) errors[`schedule-date-${row.key}`] = "開催日を入れてください。";
    if (!row.startTime) errors[`schedule-start-${row.key}`] = "開始時刻を入れてください。";
    if (!row.endTime) errors[`schedule-end-${row.key}`] = "終了時刻を入れてください。";
  }
  for (const row of value.pricePlans) {
    if (row.name.trim() === "") {
      errors[`plan-name-${row.key}`] = "プラン名を入れてください。";
    }
    const amount = row.amount.trim();
    if (amount === "") {
      errors[`plan-amount-${row.key}`] = "金額を入れてください。";
    } else if (!/^\d+$/.test(amount)) {
      errors[`plan-amount-${row.key}`] = "金額は0以上の整数で入れてください。";
    }
  }

  // 住所は「入れ始めたら都道府県・市区町村・番地まで」、入れていなければ会場名。
  // API の `refineEventAddress` と `isLocationStepComplete` にそろえる。
  const hasStructured = Boolean(
    value.prefecture || value.city || value.town || value.addressLine || value.building,
  );
  if (hasStructured) {
    if (value.prefecture.trim() === "") {
      errors["event-prefecture"] = "都道府県を入れてください。";
    }
    if (value.city.trim() === "") {
      errors["event-city"] = "市区町村を入れてください。";
    }
    if (value.addressLine.trim() === "") {
      errors["event-address-line"] = "番地を入れてください。";
    }
  } else if (value.venueName.trim() === "" && (value.location ?? "").trim() === "") {
    errors["event-venue-name"] = "会場名を入れてください。";
  }

  if (!isCapacityStepComplete(value.capacity, options.capacitySelection)) {
    errors["event-capacity-custom"] = "51人以上の人数を入れてください。";
  }

  return errors;
}

/** 欄の id の先頭と、その欄があるステップ。上から順に調べる。 */
const FIELD_STEPS: ReadonlyArray<readonly [string, EventStepKey]> = [
  ["event-title", "basic"],
  ["event-summary", "basic"],
  ["event-organizer-name", "basic"],
  ["schedule-", "basic"],
  ["plan-", "pricing"],
  ["discount-", "pricing"],
  ["event-venue-name", "location"],
  ["event-prefecture", "location"],
  ["event-city", "location"],
  ["event-town", "location"],
  ["event-address-line", "location"],
  ["event-building", "location"],
  ["event-capacity", "capacity"],
];

/** 欄の id から、その欄を出しているステップを引く。分からなければ基本情報。 */
export function stepOfField(fieldId: string): EventStepKey {
  for (const [prefix, step] of FIELD_STEPS) {
    if (fieldId.startsWith(prefix)) return step;
  }
  return "basic";
}
