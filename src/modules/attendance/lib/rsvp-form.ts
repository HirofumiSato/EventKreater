import type {
  EventPricePlanOption,
  EventScheduleOption,
  Gender,
} from "@/modules/events/types";

/**
 * 出欠の層（`DynamicRsvpBox`）が、どの欄を出すか・どの札を選べるかを決める。
 *
 * この層の決まりは「選択によって欄を出し入れしない」ことにある。入力できない欄は
 * 消さずにグレーアウトする。あとから欄が現れると、そこへ何かを書かねばならないの
 * ではないかと身構えさせるためである（`docs/front_implementation_spec.md` §2.1）。
 * 判定をここへ寄せ、コンポーネントは並べるだけにする。
 */

/** ログイン中の会員名。空白だけの名前は「無い」と見なす。 */
function normalizeMember(memberName: string | null | undefined): string | null {
  const trimmed = (memberName ?? "").trim();
  return trimmed === "" ? null : trimmed;
}

/**
 * 「お名前」の欄を出すか。ログイン中は会員名で答えるので出さない。
 * 欄だけを消して送信名を空のままにすると、名前の無い回答ができるので、
 * 送信名は必ず `rsvpSubmitName` を通す。
 */
export function showsRsvpNameField(memberName: string | null | undefined): boolean {
  return normalizeMember(memberName) === null;
}

/** 送る名前。ログイン中は会員名、未ログインは入力された名前。 */
export function rsvpSubmitName(
  memberName: string | null | undefined,
  typedName: string,
): string {
  return normalizeMember(memberName) ?? typedName.trim();
}

/** 男女別の費用プランを、選んだ性別で選べるか。共通（ANY）は常に選べる。 */
export function isRsvpPlanSelectable(plan: EventPricePlanOption, gender: Gender | ""): boolean {
  if (plan.audience === "ANY") return true;
  return gender !== "" && plan.audience === gender;
}

/**
 * 選べる費用プランだけを残す。性別が未選択なら共通プランだけになる。
 * これは「送ってよいか」の判定に使い、表示は絞らない（札は全部出して無効にする）。
 */
export function selectableRsvpPlans(
  plans: EventPricePlanOption[],
  gender: Gender | "",
): EventPricePlanOption[] {
  return plans.filter((plan) => isRsvpPlanSelectable(plan, gender));
}

/**
 * 実際に選ばれている費用プランの ID。選べる札の中から選ぶ。
 * 選んでいた札が性別の変更で選べなくなったら、先頭の選べる札へ移す。
 */
export function resolveSelectedPlanId(
  plans: EventPricePlanOption[],
  gender: Gender | "",
  selectedPlanId: string,
): string {
  const selectable = selectableRsvpPlans(plans, gender);
  if (selectable.some((plan) => plan.id === selectedPlanId)) return selectedPlanId;
  return selectable[0]?.id ?? "";
}

export interface RsvpPlanChoice {
  plan: EventPricePlanOption;
  /** 性別に合う（共通プランを含む）。 */
  selectable: boolean;
  /** 押せない。欠席・参加要望のとき、性別が合わないとき。 */
  disabled: boolean;
  checked: boolean;
}

/**
 * 費用プランの札を、表示する順のまま組む。
 *
 * 性別が未選択でも札は出す。ここで絞ると、性別を選ぶまで費用の欄ごと消え、
 * 「選んだのに何も出ない」ように見える（男女別プランしか無い催しで起きていた）。
 */
export function rsvpPlanChoices(input: {
  plans: EventPricePlanOption[];
  gender: Gender | "";
  /** 入力できる状態か。出席のときだけ true。 */
  enabled: boolean;
  /** 送信中・受付終了・プレビューで止めているか。 */
  locked: boolean;
  selectedPlanId: string;
}): RsvpPlanChoice[] {
  const checkedId = resolveSelectedPlanId(input.plans, input.gender, input.selectedPlanId);
  return input.plans.map((plan) => {
    const selectable = isRsvpPlanSelectable(plan, input.gender);
    return {
      plan,
      selectable,
      disabled: input.locked || !input.enabled || !selectable,
      checked: plan.id === checkedId,
    };
  });
}

export interface RsvpScheduleChoice {
  schedule: EventScheduleOption;
  disabled: boolean;
  checked: boolean;
}

/**
 * 出席する日時の札。複数日を選べるので、値は選んだ日時の配列で受ける。
 * 選んでいない日は `checked: false` のまま置き、札は消さない。
 */
export function rsvpScheduleChoices(input: {
  schedules: EventScheduleOption[];
  enabled: boolean;
  locked: boolean;
  selectedScheduleIds: string[];
}): RsvpScheduleChoice[] {
  const selected = new Set(input.selectedScheduleIds);
  return input.schedules.map((schedule) => ({
    schedule,
    disabled: input.locked || !input.enabled,
    checked: selected.has(schedule.id),
  }));
}

/**
 * 日時の札を押したときの選択。選んでいれば外し、選んでいなければ足す。
 * 選んだ順はイベントの並びへそろえるため、ここでは集合としてだけ扱う。
 */
export function toggleRsvpScheduleId(current: string[], scheduleId: string): string[] {
  return current.includes(scheduleId)
    ? current.filter((id) => id !== scheduleId)
    : [...current, scheduleId];
}

/** 要約に出す短い日付（`2026-11-21` → `11/21`）。 */
export function rsvpScheduleShortLabel(eventDate: string): string {
  const [, month, day] = eventDate.split("-");
  if (!month || !day) return eventDate;
  return `${Number(month)}/${Number(day)}`;
}

/** 選んだ日時の短いラベル。イベントの並び順で返す。1 件も選んでいなければ空配列。 */
export function rsvpScheduleLabels(
  schedules: EventScheduleOption[],
  selectedScheduleIds: string[],
): string[] {
  const selected = new Set(selectedScheduleIds);
  return schedules
    .filter((row) => selected.has(row.id))
    .map((row) => rsvpScheduleShortLabel(row.eventDate));
}

/** 自分を含む参加人数の下限・上限。 */
export const RSVP_PARTY_SIZE_MIN = 1;
export const RSVP_PARTY_SIZE_MAX = 20;

/**
 * 参加人数の入力を、送れる値に丸める。
 * 空・小数・0 以下・上限超えは、入力の途中でも送れる値へ寄せる（保留しない）。
 */
export function clampRsvpPartySize(value: string | number): number {
  const parsed = typeof value === "number" ? value : Number(value.trim());
  if (!Number.isFinite(parsed)) return RSVP_PARTY_SIZE_MIN;
  const rounded = Math.floor(parsed);
  if (rounded < RSVP_PARTY_SIZE_MIN) return RSVP_PARTY_SIZE_MIN;
  if (rounded > RSVP_PARTY_SIZE_MAX) return RSVP_PARTY_SIZE_MAX;
  return rounded;
}

