import { describe, expect, it } from "vitest";
import { isSemanticThemeId } from "@/lib/semantic-themes";
import { findProfile, SAMPLE_PROFILES } from "@/app/sample/profiles";
import { profileUrlProblem } from "@/modules/organizers/lib/profile";
import { MAX_PROFILE_TAGS, PROFILE_TAGS, type ProfileTag } from "@/modules/organizers/types";

/** 公開ページが出すリンクの許可ホスト。`profile.ts` の `LINK_RULES` と同じ。 */
const LINK_HOSTS: Record<string, string[]> = {
  X: ["x.com", "twitter.com"],
  INSTAGRAM: ["instagram.com"],
};

/**
 * 見本の主催者プロフィール（SCR-PUB-18）の仕様。
 *
 * DB を持たない固定データなので、本物のプロフィールと同じ上限・同じリンク規則に
 * 収まっていることをここで止める。画面は `/organizers/[userId]` と同じ部品で描く。
 */
describe("主催者のプロフィールの見本", () => {
  it("6 人いて、slug は重複せず URL に使える文字だけ", () => {
    expect(SAMPLE_PROFILES).toHaveLength(6);
    const slugs = SAMPLE_PROFILES.map((profile) => profile.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const slug of slugs) {
      expect(slug).toMatch(/^[a-z0-9-]+$/);
    }
  });

  it("名前・種別・肩書き・自己紹介・活動エリアが、製品の上限に収まる", () => {
    for (const profile of SAMPLE_PROFILES) {
      expect(profile.name.trim().length).toBeGreaterThan(0);
      expect(profile.kind.trim().length).toBeGreaterThan(0);
      expect(profile.profile.headline?.length ?? 0).toBeLessThanOrEqual(60);
      expect(profile.profile.bio?.length ?? 0).toBeLessThanOrEqual(400);
      expect(profile.profile.area?.length ?? 0).toBeLessThanOrEqual(50);
      // 見本は公開済みで、アイコンは頭文字に任せる。
      expect(profile.profile.isPublished).toBe(true);
      expect(profile.profile.avatarUrl).toBeNull();
    }
  });

  it("テーマは製品が知っている ID だけを使う", () => {
    for (const profile of SAMPLE_PROFILES) {
      expect(isSemanticThemeId(profile.profile.themeId)).toBe(true);
    }
  });

  it("ジャンルは固定リストの中から 3 つまでで、重複しない", () => {
    for (const profile of SAMPLE_PROFILES) {
      const tags = profile.profile.tags;
      expect(tags.length).toBeGreaterThan(0);
      expect(tags.length).toBeLessThanOrEqual(MAX_PROFILE_TAGS);
      expect(new Set(tags).size).toBe(tags.length);
      for (const tag of tags) {
        expect(PROFILE_TAGS).toContain(tag as ProfileTag);
      }
    }
  });

  it("リンクは X と Instagram の https で、許可したホストだけ", () => {
    for (const profile of SAMPLE_PROFILES) {
      const kinds = profile.profile.links.map((link) => link.kind);
      expect(kinds).toEqual(["X", "INSTAGRAM"]);
      for (const link of profile.profile.links) {
        expect(profileUrlProblem(link.url, LINK_HOSTS[link.kind], link.label)).toBeNull();
        expect(link.url.startsWith("https://")).toBe(true);
      }
    }
  });

  it("実績は開催回数と開始年を持ち、知らない slug は引けない", () => {
    for (const profile of SAMPLE_PROFILES) {
      const stats = profile.profile.stats;
      expect(stats).not.toBeNull();
      expect(stats?.eventCount ?? 0).toBeGreaterThan(0);
      expect(stats?.sinceYear ?? 0).toBeGreaterThan(2000);
      expect(stats?.sinceYear ?? 0).toBeLessThanOrEqual(2026);
    }
    const first = SAMPLE_PROFILES[0];
    expect(findProfile(first.slug)?.name).toBe(first.name);
    expect(findProfile("unknown")).toBeUndefined();
  });
});
