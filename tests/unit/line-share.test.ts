import { describe, expect, it } from "vitest";
import {
  absoluteShareUrl,
  buildShareText,
  lineShareUrl,
  shareScheduleLabel,
} from "@/modules/organizers/lib/share";

const schedules = [
  { eventDate: "2026-10-22", eventTime: "18:00〜21:00" },
  { eventDate: "2026-10-24", eventTime: "10:00〜12:00" },
];

describe("shareScheduleLabel", () => {
  it("先頭の開催日を月日と曜日で出し、残りは件数にまとめる", () => {
    expect(shareScheduleLabel(schedules)).toBe("10月22日（木） 18:00〜21:00 ほか1件");
  });

  it("1件だけなら件数を付けない", () => {
    expect(shareScheduleLabel([schedules[0]])).toBe("10月22日（木） 18:00〜21:00");
  });

  it("時刻が空なら日付だけを出す", () => {
    expect(shareScheduleLabel([{ eventDate: "2026-10-22", eventTime: "" }])).toBe(
      "10月22日（木）",
    );
  });

  it("開催日が無ければ空文字を返す", () => {
    expect(shareScheduleLabel([])).toBe("");
  });
});

describe("buildShareText", () => {
  it("題名・日時・場所・URL を1行ずつ並べる", () => {
    expect(
      buildShareText({
        title: "芋煮会",
        schedules: [schedules[0]],
        location: "河原",
        url: "https://example.com/events/event-1",
      }),
    ).toBe("芋煮会\n10月22日（木） 18:00〜21:00\n河原\nhttps://example.com/events/event-1");
  });

  it("URL は末尾に1回だけ入れる", () => {
    const text = buildShareText({
      title: "芋煮会",
      schedules: [schedules[0]],
      location: "河原",
      url: "https://example.com/events/event-1",
    });
    expect(text.split("https://example.com/events/event-1")).toHaveLength(2);
    expect(text.endsWith("https://example.com/events/event-1")).toBe(true);
  });

  it("場所が空なら空行を作らない", () => {
    expect(
      buildShareText({
        title: "芋煮会",
        schedules: [schedules[0]],
        location: "   ",
        url: "https://example.com/events/event-1",
      }),
    ).toBe("芋煮会\n10月22日（木） 18:00〜21:00\nhttps://example.com/events/event-1");
  });

  it("題名と場所の前後の空白を落とす", () => {
    expect(
      buildShareText({
        title: "  芋煮会  ",
        schedules: [],
        location: " 河原 ",
        url: "https://example.com/events/event-1",
      }),
    ).toBe("芋煮会\n河原\nhttps://example.com/events/event-1");
  });
});

describe("lineShareUrl", () => {
  it("https の LINE URL スキームを使う", () => {
    expect(lineShareUrl("こんにちは")).toBe(
      "https://line.me/R/share?text=%E3%81%93%E3%82%93%E3%81%AB%E3%81%A1%E3%81%AF",
    );
    expect(lineShareUrl("こんにちは").startsWith("line://")).toBe(false);
  });

  it("改行をパーセントエンコードする", () => {
    const url = lineShareUrl("1行目\n2行目");
    expect(url).toBe("https://line.me/R/share?text=1%E8%A1%8C%E7%9B%AE%0A2%E8%A1%8C%E7%9B%AE");
    expect(url).not.toContain("\n");
  });

  it("本文中の & と ? と = を保つ", () => {
    const url = lineShareUrl("https://example.com/events/1?a=1&b=2");
    // クエリの区切りとして解釈されないよう、本文の記号はすべてエスケープする。
    expect(url).toBe(
      "https://line.me/R/share?text=https%3A%2F%2Fexample.com%2Fevents%2F1%3Fa%3D1%26b%3D2",
    );
  });

  it("日本語を含む本文を、そのままクエリに置ける", () => {
    const url = lineShareUrl("芋煮会");
    expect(() => new URL(url)).not.toThrow();
    expect(new URL(url).searchParams.get("text")).toBe("芋煮会");
  });
});

describe("absoluteShareUrl", () => {
  it("パスから絶対 URL を作る", () => {
    expect(absoluteShareUrl("/events/event-1", "https://example.com")).toBe(
      "https://example.com/events/event-1",
    );
  });

  it("origin の末尾にスラッシュがあっても二重にしない", () => {
    expect(absoluteShareUrl("/events/event-1", "https://example.com/")).toBe(
      "https://example.com/events/event-1",
    );
  });

  it("ローカルの開発環境でも同じ形になる", () => {
    expect(absoluteShareUrl("/events/abc", "http://localhost:3000")).toBe(
      "http://localhost:3000/events/abc",
    );
  });
});
