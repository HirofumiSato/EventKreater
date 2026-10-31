import { existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { isSemanticThemeId } from "@/lib/semantic-themes";
import { findSample, SAMPLE_EVENTS } from "@/app/sample/samples";

const ROOT = process.cwd();

/**
 * 見本（SCR-PUB-16 / SCR-PUB-17）の仕様。
 * 見本は DB を持たないので、データの矛盾をここで止める。
 */
describe("告知ページの見本", () => {
  it("slug は重複せず、詳細の URL がすべて一意になる", () => {
    const slugs = SAMPLE_EVENTS.map((event) => event.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it("チラシの画像が public/samples に実在する", () => {
    for (const event of SAMPLE_EVENTS) {
      expect(event.flyerSrc.startsWith("/samples/")).toBe(true);
      expect(existsSync(path.join(ROOT, "public", event.flyerSrc))).toBe(true);
    }
  });

  it("テーマは製品が知っている ID だけを使う", () => {
    for (const event of SAMPLE_EVENTS) {
      expect(isSemanticThemeId(event.themeId)).toBe(true);
    }
  });

  it("日程と費用プランを 1 件以上持ち、人数が定員を超えない", () => {
    for (const event of SAMPLE_EVENTS) {
      expect(event.schedules.length).toBeGreaterThan(0);
      expect(event.pricePlans.length).toBeGreaterThan(0);
      expect(event.attendingCount).toBeLessThanOrEqual(event.capacity);
      expect(event.waitlistCount).toBeGreaterThanOrEqual(0);
      expect(event.title.trim().length).toBeGreaterThan(0);
      expect(event.kind.trim().length).toBeGreaterThan(0);
      expect(event.intro.length).toBeLessThanOrEqual(40);
    }
  });

  it("主催者と共同主催者は公開プロフィールへのリンクを持たない", () => {
    for (const event of SAMPLE_EVENTS) {
      expect(event.organizers.owner?.userId ?? null).toBeNull();
      for (const coHost of event.organizers.coHosts) {
        expect(coHost.userId).toBeNull();
      }
    }
  });

  it("slug から 1 件を引ける。知らない slug は undefined", () => {
    expect(findSample(SAMPLE_EVENTS[0].slug)?.title).toBe(SAMPLE_EVENTS[0].title);
    expect(findSample("unknown")).toBeUndefined();
  });
});
