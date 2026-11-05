import { describe, expect, it } from "vitest";
import {
  isLongVoiceField,
  LONG_VOICE_FIELDS,
  shouldAutoConfirm,
} from "@/modules/events/lib/voice/confirm";
import { VOICE_FIELDS, voiceFieldByKey } from "@/modules/events/lib/voice/fields";
import type { VoiceFieldKey } from "@/modules/events/lib/voice/types";

/** 隠れた既定値（未指定は `"always"`）を、実際の欄の定義で確かめる。 */
describe("確認を省くかの判定", () => {
  it("未指定の欄は必ず確認する（既定は always）", () => {
    const field = voiceFieldByKey("title");
    expect(field).not.toBeNull();
    if (!field) return;
    expect(field.confirm).toBeUndefined();
    expect(shouldAutoConfirm(field, { title: "忘年会" })).toBe(false);
  });

  it("形が閉じている欄は、値が読めた時点で確認を省く", () => {
    const field = voiceFieldByKey("scheduleDate");
    expect(field).not.toBeNull();
    if (!field) return;
    expect(field.confirm).toBe("auto");
    expect(shouldAutoConfirm(field, { schedules: [] })).toBe(true);
  });

  it("読めなかった（patch が null）ときは、auto でも確認する", () => {
    const field = voiceFieldByKey("capacity");
    expect(field).not.toBeNull();
    if (!field) return;
    expect(shouldAutoConfirm(field, null)).toBe(false);
  });
});

describe("auto にする欄", () => {
  it("形が閉じている 9 つだけが auto になる", () => {
    const auto = VOICE_FIELDS.filter((field) => field.confirm === "auto").map(
      (field) => field.key,
    );
    expect(auto).toEqual([
      "scheduleDate",
      "scheduleStart",
      "scheduleEnd",
      "planAmount",
      "postalCode",
      "prefecture",
      "rainPolicy",
      "capacity",
      "rsvpDeadline",
    ]);
  });

  it("自由文の欄は auto にしない", () => {
    const free: VoiceFieldKey[] = [
      "title",
      "organizerName",
      "planName",
      "planNote",
      "venueName",
      "city",
      "town",
      "addressLine",
      "building",
    ];
    for (const key of free) {
      expect(voiceFieldByKey(key)?.confirm).toBeUndefined();
    }
  });
});

describe("確認ダイアログの入力の形", () => {
  it("長い欄だけ複数行にする", () => {
    const long: VoiceFieldKey[] = ["venueName", "planNote", "city", "town", "addressLine", "building"];
    for (const key of long) {
      expect(isLongVoiceField(key)).toBe(true);
      expect(LONG_VOICE_FIELDS.has(key)).toBe(true);
    }
  });

  it("短い欄は 1 行にする", () => {
    const short: VoiceFieldKey[] = [
      "title",
      "organizerName",
      "planName",
      "planAmount",
      "capacity",
      "postalCode",
      "prefecture",
      "scheduleDate",
      "scheduleStart",
      "scheduleEnd",
      "rsvpDeadline",
    ];
    for (const key of short) {
      expect(isLongVoiceField(key)).toBe(false);
    }
  });
});
