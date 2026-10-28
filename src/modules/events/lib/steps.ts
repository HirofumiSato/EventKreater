import { composeEventTime, composeLocation, formatYen } from "@/lib/serializers";
import { semanticTheme } from "@/lib/semantic-themes";
import type { CapacitySelection } from "@/modules/events/lib/capacity";
import type { EventFormValues } from "@/modules/events/types";

/**
 * 新規イベント作成のステップ。入力項目は減らさず、一度に見せる量だけを減らす。
 * 画面はこの順でアコーディオンに並べ、開いているステップの入力欄だけを出す。
 */
export type EventStepKey = "basic" | "pricing" | "location" | "capacity" | "flyer";

export interface EventStep {
  key: EventStepKey;
  /** 見出しに出す短い名前。 */
  title: string;
  /** 見出しの下に出す補足。 */
  hint: string;
  /** 必須のステップか。任意のステップは自動で開かない。 */
  mandatory: boolean;
}

export const EVENT_STEPS: readonly EventStep[] = [
  {
    key: "basic",
    title: "催しの名前と開催日時",
    hint: "何をいつ開くか。チラシにも告知ページにも出ます。",
    mandatory: true,
  },
  {
    key: "pricing",
    title: "費用プラン",
    hint: "参加者が選ぶ金額です。あとから追加できます。",
    mandatory: true,
  },
  {
    key: "location",
    title: "開催場所",
    hint: "会場名だけでも保存できます。雨天時の方針もここで決めます。",
    mandatory: true,
  },
  {
    key: "capacity",
    title: "定員と申し込み期限",
    hint: "どちらも任意です。空欄なら制限なしで受け付けます。",
    mandatory: false,
  },
  {
    key: "flyer",
    // 見出しは省略せずに書く。ここで何を決めるステップかを、開く前に分かるようにする。
    title: "イベントページテーマ選択&チラシ生成",
    hint: "テーマは告知ページの見た目と、チラシの雰囲気に効きます。チラシは作らなくても公開できます。",
    mandatory: false,
  },
];

const MANDATORY_KEYS: readonly EventStepKey[] = EVENT_STEPS.filter((step) => step.mandatory).map(
  (step) => step.key,
);

function hasText(value: string): boolean {
  return value.trim().length > 0;
}

/** 催しの名前と、すべての開催日時の日付・開始・終了が埋まっているか。 */
export function isBasicStepComplete(value: EventFormValues): boolean {
  if (!hasText(value.title)) return false;
  if (value.schedules.length === 0) return false;
  return value.schedules.every(
    (row) => Boolean(row.eventDate) && Boolean(row.startTime) && Boolean(row.endTime),
  );
}

/** すべての費用プランに名前と、0 以上の整数の金額が入っているか。 */
export function isPricingStepComplete(value: EventFormValues): boolean {
  if (value.pricePlans.length === 0) return false;
  return value.pricePlans.every(
    (row) => hasText(row.name) && /^\d+$/.test(row.amount.trim()),
  );
}

/**
 * 開催場所が保存できる形か。API の `refineEventAddress` と同じ条件にする。
 * 構造化住所を入れ始めたら都道府県・市区町村・番地まで、入れていなければ会場名か従来の場所。
 */
export function isLocationStepComplete(value: EventFormValues): boolean {
  const hasStructured = Boolean(
    value.prefecture || value.city || value.town || value.addressLine || value.building,
  );
  if (hasStructured) {
    return Boolean(hasText(value.prefecture) && hasText(value.city) && hasText(value.addressLine));
  }
  return hasText(value.venueName) || hasText(value.location);
}

/**
 * 定員と申し込み期限は任意なので、常に次へ進める。
 * ただし「51以上」の数値入力を空にしたままでは進めない。
 */
export function isCapacityStepComplete(
  capacity: number | null,
  selection: CapacitySelection,
): boolean {
  if (selection !== "custom") return true;
  return capacity !== null && capacity >= 1;
}

/** チラシは作らなくても公開できる。「作らない」を選んだかを画面側で持つ。 */
export function isFlyerStepComplete(value: EventFormValues, flyerSkipped: boolean): boolean {
  return Boolean(value.flyerAssetId) || flyerSkipped;
}

export function isStepComplete(
  key: EventStepKey,
  value: EventFormValues,
  options: { capacitySelection: CapacitySelection; flyerSkipped: boolean },
): boolean {
  switch (key) {
    case "basic":
      return isBasicStepComplete(value);
    case "pricing":
      return isPricingStepComplete(value);
    case "location":
      return isLocationStepComplete(value);
    case "capacity":
      return isCapacityStepComplete(value.capacity, options.capacitySelection);
    case "flyer":
      return isFlyerStepComplete(value, options.flyerSkipped);
  }
}

/** 必須のステップのうち、まだ埋まっていない最初のもの。全部済みなら null。 */
export function firstIncompleteMandatoryStep(value: EventFormValues): EventStepKey | null {
  return (
    MANDATORY_KEYS.find(
      (key) => !isStepComplete(key, value, { capacitySelection: "", flyerSkipped: false }),
    ) ?? null
  );
}

/**
 * 下書き保存に必要なステップ。公開までに埋めればよい定員・申し込み期限とチラシは含めない。
 * API の `SaveEventDraftSchema` も同じ 3 つだけを要求する。
 */
export const DRAFT_REQUIRED_STEP_KEYS: readonly EventStepKey[] = MANDATORY_KEYS;

/** 下書きとして保存できる状態か。保存できないときは、直すべき最初のステップを返す。 */
export function firstIncompleteDraftStep(value: EventFormValues): EventStepKey | null {
  return firstIncompleteMandatoryStep(value);
}

export function isDraftReady(value: EventFormValues): boolean {
  return firstIncompleteDraftStep(value) === null;
}

/**
 * 復元したときに開くステップ。必須が残っていればそこ、
 * 全部済みなら任意の最初（定員と申し込み期限）にする。
 */
export function resumeStepKey(value: EventFormValues): EventStepKey {
  return firstIncompleteMandatoryStep(value) ?? "capacity";
}

const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"] as const;

/** 2026-09-21 → 9月21日（月）。日付として読めなければそのまま返す。 */
export function formatShortDate(date: string): string {
  if (!date) return "";
  const parsed = new Date(`${date}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) return date;
  return `${parsed.getUTCMonth() + 1}月${parsed.getUTCDate()}日（${WEEKDAYS[parsed.getUTCDay()]}）`;
}

/** 2026-09-18T23:59 → 9月18日 23:59。 */
export function formatShortDeadline(deadline: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(deadline);
  if (!match) return "";
  return `${Number(match[2])}月${Number(match[3])}日 ${match[4]}:${match[5]}`;
}

/** 畳んだステップの見出しに出す 1 行。まだ何も入っていなければ null。 */
export function summarizeStep(key: EventStepKey, value: EventFormValues): string | null {
  switch (key) {
    case "basic": {
      const first = value.schedules[0];
      const when = first
        ? [formatShortDate(first.eventDate), composeEventTime(first.startTime, first.endTime)]
            .filter(Boolean)
            .join(" ")
        : "";
      const more = value.schedules.length > 1 ? `ほか${value.schedules.length - 1}件` : "";
      const parts = [value.title.trim(), when, more].filter(Boolean);
      return parts.length > 0 ? parts.join(" / ") : null;
    }
    case "pricing": {
      const plans = value.pricePlans.filter((row) => hasText(row.name));
      if (plans.length === 0) return null;
      const text = plans
        .slice(0, 2)
        .map((row) => `${row.name.trim()} ${formatYen(Number(row.amount || 0))}`)
        .join(" / ");
      return plans.length > 2 ? `${text} ほか${plans.length - 2}件` : text;
    }
    case "location":
      return composeLocation(value) || null;
    case "capacity": {
      const capacity = value.capacity === null ? "定員なし" : `定員 ${value.capacity}名`;
      const deadline = value.rsvpDeadline
        ? `期限 ${formatShortDeadline(value.rsvpDeadline)}`
        : "期限なし";
      return `${capacity} / ${deadline}`;
    }
    case "flyer": {
      // 見出しがテーマとチラシの両方を扱うので、畳んだ行にもテーマを出す。
      const theme = semanticTheme(value.themeId);
      const flyer = value.flyerAssetId ? "チラシを作成済み" : "チラシなし";
      return theme ? `テーマ ${theme.label} / ${flyer}` : flyer;
    }
  }
}
