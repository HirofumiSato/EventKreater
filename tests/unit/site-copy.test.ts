import { describe, expect, it } from "vitest";
import { SITE } from "@/lib/site";

/**
 * 公開画面の主操作の文言。
 *
 * ボタンは 10 文字以内（`docs/front_implementation_spec.md` §1.3）、
 * 注記は 30 文字以内。無料の条件はボタンに詰めず、直下の注記で伝える。
 * 「無料チケット」は公開向けの文言から外す（利用者の言葉ではないため）。
 */
describe("公開画面の主操作", () => {
  it("主操作は 10 文字以内で、条件を書かない", () => {
    expect(SITE.cta.createEventFree.length).toBeLessThanOrEqual(10);
    expect(SITE.cta.createEventFree).not.toContain("2回");
  });

  it("無料の条件は注記で伝え、チケットという語を使わない", () => {
    expect(SITE.cta.freeNote.length).toBeLessThanOrEqual(30);
    expect(SITE.cta.freeNote).toContain("2回");
    expect(SITE.cta.freeNote).not.toContain("チケット");
  });

  it("注記にカードの話を混ぜない", () => {
    // 0 円で始められることだけを 1 行で伝える。カードの要否は料金ページが持つ。
    expect(SITE.cta.freeNote).not.toContain("カード");
    expect(SITE.cta.freeNote).not.toContain("クレジット");
  });

  it("見本への導線を持つ", () => {
    expect(SITE.nav.sample.href).toBe("/sample");
    expect(SITE.nav.sample.label.length).toBeLessThanOrEqual(10);
  });
});
