import { describe, expect, it } from "vitest";
import { toFlyerPayload } from "@/modules/flyers/lib/flyer";
import type { GenerateFlyerInput } from "@/lib/schemas";

const INPUT: GenerateFlyerInput = {
  title: "秋のゆるごはん会",
  eventDate: "2026-11-14",
  eventTime: "18:30〜21:00",
  price: "3,000円",
  location: "Jazz Bar MOON 新宿東口",
  rainPolicy: "RAIN_OR_SHINE",
  capacity: 15,
  templateId: "style_1_bar_stylish",
  layoutId: "classic",
};

describe("toFlyerPayload", () => {
  it("日付は紙面に焼ける日本語にしてから渡す", () => {
    // ISO のまま渡すと、紙面では細いハイフンが並ぶだけで日付に読めない。
    expect(toFlyerPayload(INPUT).event_date).toBe("2026年11月14日（土）");
  });

  it("雨の扱いは日本語の札にして渡す", () => {
    expect(toFlyerPayload({ ...INPUT, rainPolicy: "CANCEL_ON_RAIN" }).rain_policy).toBe("雨天中止");
  });
});
