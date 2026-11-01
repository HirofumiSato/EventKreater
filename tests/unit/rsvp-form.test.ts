import { describe, expect, it } from "vitest";
import {
  isRsvpPlanSelectable,
  resolveSelectedPlanId,
  rsvpPlanChoices,
  rsvpScheduleChoices,
  rsvpSubmitName,
  selectableRsvpPlans,
  showsRsvpNameField,
} from "@/modules/attendance/lib/rsvp-form";
import type {
  EventPricePlanOption,
  EventScheduleOption,
  PriceAudience,
} from "@/modules/events/types";

function plan(
  id: string,
  audience: PriceAudience,
  overrides: Partial<EventPricePlanOption> = {},
): EventPricePlanOption {
  return {
    id,
    name: `プラン${id}`,
    audience,
    amount: 3000,
    note: null,
    price: "3,000円",
    ...overrides,
  };
}

function schedule(id: string, eventDate: string): EventScheduleOption {
  return {
    id,
    eventDate,
    startTime: "13:00",
    endTime: "21:00",
    eventTime: "13:00〜21:00",
  };
}

const PLANS = [plan("any", "ANY"), plan("male", "MALE"), plan("female", "FEMALE")];

describe("名前の欄", () => {
  it("ログイン中は名前の欄を出さない", () => {
    expect(showsRsvpNameField("佐藤 みのり")).toBe(false);
  });

  it("未ログインと空白だけの名前は欄を出す", () => {
    expect(showsRsvpNameField(null)).toBe(true);
    expect(showsRsvpNameField(undefined)).toBe(true);
    expect(showsRsvpNameField("")).toBe(true);
    expect(showsRsvpNameField("   ")).toBe(true);
  });

  it("ログイン中の送信名は会員名。入力欄の値に引きずられない", () => {
    expect(rsvpSubmitName("佐藤 みのり", "")).toBe("佐藤 みのり");
    expect(rsvpSubmitName("佐藤 みのり", "別の名前")).toBe("佐藤 みのり");
  });

  it("未ログインの送信名は入力の前後の空白を落とす", () => {
    expect(rsvpSubmitName(null, "  田中  ")).toBe("田中");
    expect(rsvpSubmitName("  ", "田中")).toBe("田中");
  });
});

describe("選べる費用プラン", () => {
  it("共通プランは性別に関係なく選べる", () => {
    expect(isRsvpPlanSelectable(plan("any", "ANY"), "")).toBe(true);
    expect(isRsvpPlanSelectable(plan("any", "ANY"), "FEMALE")).toBe(true);
  });

  it("男女別プランは一致する性別のときだけ選べる", () => {
    expect(isRsvpPlanSelectable(plan("male", "MALE"), "MALE")).toBe(true);
    expect(isRsvpPlanSelectable(plan("male", "MALE"), "FEMALE")).toBe(false);
    expect(isRsvpPlanSelectable(plan("female", "FEMALE"), "FEMALE")).toBe(true);
  });

  it("性別が未選択なら共通プランだけが選べる", () => {
    expect(selectableRsvpPlans(PLANS, "").map((row) => row.id)).toEqual(["any"]);
    expect(selectableRsvpPlans(PLANS, "MALE").map((row) => row.id)).toEqual(["any", "male"]);
    expect(selectableRsvpPlans(PLANS, "FEMALE").map((row) => row.id)).toEqual(["any", "female"]);
  });

  it("男女別プランしか無くても、性別を選んだ時点で選べるようになる", () => {
    const gendered = [plan("male", "MALE"), plan("female", "FEMALE")];
    expect(selectableRsvpPlans(gendered, "")).toEqual([]);
    expect(selectableRsvpPlans(gendered, "MALE").map((row) => row.id)).toEqual(["male"]);
  });
});

describe("選ばれている費用プラン", () => {
  it("選べる札を選んでいればそのまま", () => {
    expect(resolveSelectedPlanId(PLANS, "MALE", "male")).toBe("male");
  });

  it("性別の変更で選べなくなったら、先頭の選べる札へ移す", () => {
    expect(resolveSelectedPlanId(PLANS, "FEMALE", "male")).toBe("any");
  });

  it("選べる札が無ければ空。勝手に無効な札を選ばない", () => {
    const gendered = [plan("male", "MALE")];
    expect(resolveSelectedPlanId(gendered, "", "")).toBe("");
    expect(resolveSelectedPlanId(gendered, "FEMALE", "")).toBe("");
  });

  it("初期値が空でも先頭の選べる札を選ぶ", () => {
    expect(resolveSelectedPlanId(PLANS, "", "")).toBe("any");
  });
});

describe("費用プランの札", () => {
  const base = { plans: PLANS, enabled: true, locked: false, selectedPlanId: "" };

  it("性別が未選択でも全プランを出し、男女別は押せなくする", () => {
    const rows = rsvpPlanChoices({ ...base, gender: "" });
    expect(rows.map((row) => row.plan.id)).toEqual(["any", "male", "female"]);
    expect(rows.map((row) => row.disabled)).toEqual([false, true, true]);
    expect(rows.find((row) => row.checked)?.plan.id).toBe("any");
  });

  it("男性を選ぶと男性プランだけ有効。女性プランは札を残して押せなくする", () => {
    const rows = rsvpPlanChoices({ ...base, gender: "MALE" });
    expect(rows.map((row) => row.plan.id)).toEqual(["any", "male", "female"]);
    expect(rows.map((row) => row.disabled)).toEqual([false, false, true]);
  });

  it("1件だけの男女別プランでも札を出す", () => {
    const rows = rsvpPlanChoices({
      ...base,
      plans: [plan("male", "MALE")],
      gender: "MALE",
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].disabled).toBe(false);
    expect(rows[0].checked).toBe(true);
  });

  it("欠席・参加要望のときは、全部の札を残して押せなくする", () => {
    const rows = rsvpPlanChoices({ ...base, gender: "MALE", enabled: false });
    expect(rows.map((row) => row.plan.id)).toEqual(["any", "male", "female"]);
    expect(rows.every((row) => row.disabled)).toBe(true);
  });

  it("送信中・受付終了・プレビューでは押せなくする", () => {
    const rows = rsvpPlanChoices({ ...base, gender: "MALE", locked: true });
    expect(rows.every((row) => row.disabled)).toBe(true);
  });
});

describe("出席する日時の札", () => {
  const schedules = [schedule("a", "2026-11-21"), schedule("b", "2026-11-22")];

  it("選んだ日時を選んだままにする", () => {
    const rows = rsvpScheduleChoices({
      schedules,
      enabled: true,
      locked: false,
      selectedScheduleId: "b",
    });
    expect(rows.map((row) => row.checked)).toEqual([false, true]);
  });

  it("値が無い・候補に無いときは先頭を選ぶ", () => {
    const rows = rsvpScheduleChoices({
      schedules,
      enabled: true,
      locked: false,
      selectedScheduleId: "missing",
    });
    expect(rows.map((row) => row.checked)).toEqual([true, false]);
  });

  it("欠席・参加要望のときは、札を残して押せなくする", () => {
    const rows = rsvpScheduleChoices({
      schedules,
      enabled: false,
      locked: false,
      selectedScheduleId: "a",
    });
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.disabled)).toBe(true);
  });
});
