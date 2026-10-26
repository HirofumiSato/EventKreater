import { describe, expect, it } from "vitest";
import { OrganizerProfileSchema } from "@/lib/schemas";
import {
  normalizeProfileTags,
  profileBioExcerpt,
  profileContentFromDraft,
  profileInitial,
  profileIsPublished,
  profileLinks,
  profileStats,
  profileUrlProblem,
} from "@/modules/organizers/lib/profile";
import { organizerProfileRedirectPath } from "@/modules/organizers/lib/public-page";
import { EMPTY_PROFILE_DRAFT, type OrganizerProfileDraft } from "@/modules/organizers/types";

const TODAY = "2026-10-22";

function draft(overrides: Partial<OrganizerProfileDraft> = {}): OrganizerProfileDraft {
  return { ...EMPTY_PROFILE_DRAFT, ...overrides };
}

describe("profileLinks", () => {
  it("X・Instagram の順に並べ、Webサイトと LINE は出さない", () => {
    const links = profileLinks({
      xUrl: "https://x.com/example",
      instagramUrl: "https://www.instagram.com/example",
      websiteUrl: "https://example.com",
      lineUrl: "https://lin.ee/abc",
    });

    expect(links.map((link) => link.kind)).toEqual(["X", "INSTAGRAM"]);
    expect(links.map((link) => link.label)).toEqual(["X", "Instagram"]);
  });

  it("未入力と空白だけの項目は飛ばす", () => {
    const links = profileLinks({ xUrl: "", instagramUrl: "  ", websiteUrl: "", lineUrl: "" });

    expect(links).toEqual([]);
  });

  it("前後の空白を落として載せる", () => {
    const links = profileLinks({
      xUrl: "  https://x.com/example  ",
      instagramUrl: "",
      websiteUrl: "",
      lineUrl: "",
    });

    expect(links[0].url).toBe("https://x.com/example");
  });
});

describe("profileUrlProblem", () => {
  it("https の正しいホストは通す", () => {
    expect(profileUrlProblem("https://x.com/example", ["x.com", "twitter.com"], "X")).toBeNull();
    expect(profileUrlProblem("https://twitter.com/example", ["x.com", "twitter.com"], "X")).toBeNull();
    expect(profileUrlProblem("https://www.instagram.com/example", ["instagram.com"], "Instagram")).toBeNull();
    expect(profileUrlProblem("https://lin.ee/abc", ["lin.ee", "line.me"], "LINE")).toBeNull();
    expect(profileUrlProblem("https://example.com", [], "Webサイト")).toBeNull();
  });

  it("http は理由を返す", () => {
    expect(profileUrlProblem("http://example.com", [], "Webサイト")).toContain("https://");
  });

  it("URL でない文字列は理由を返す", () => {
    expect(profileUrlProblem("example.com", [], "Webサイト")).toContain("https://");
  });

  it("許可していないホストは理由を返す", () => {
    expect(profileUrlProblem("https://example.com/example", ["instagram.com"], "Instagram")).toContain(
      "instagram.com",
    );
  });

  it("ホストの見た目が似ているだけの別ドメインは通さない", () => {
    expect(profileUrlProblem("https://notinstagram.com/example", ["instagram.com"], "Instagram")).not.toBeNull();
  });

  it("ユーザー名やパスワードを含む URL は通さない", () => {
    expect(profileUrlProblem("https://user:pass@example.com", [], "Webサイト")).not.toBeNull();
  });
});

describe("profileStats", () => {
  const held = (eventDate: string, status: "PUBLISHED" | "DRAFT" | "CLOSED" = "PUBLISHED", isDeleted = false) => ({
    status,
    isDeleted,
    schedules: [{ eventDate }],
  });

  it("開催済みの催しだけを数える", () => {
    const stats = profileStats(
      [
        held("2025-04-01"),
        held("2026-10-01", "CLOSED"),
        held("2026-12-01"),
        held("2026-09-01", "DRAFT"),
        held("2026-08-01", "PUBLISHED", true),
      ],
      TODAY,
    );

    expect(stats).toEqual({ eventCount: 2, sinceYear: 2025 });
  });

  it("今日の催しは開催済みに数える", () => {
    expect(profileStats([held(TODAY)], TODAY)).toEqual({ eventCount: 1, sinceYear: 2026 });
  });

  it("複数の候補日を持つ催しは1回として数える", () => {
    const stats = profileStats(
      [{ status: "PUBLISHED", isDeleted: false, schedules: [{ eventDate: "2025-11-01" }, { eventDate: "2026-01-05" }] }],
      TODAY,
    );

    expect(stats).toEqual({ eventCount: 1, sinceYear: 2025 });
  });

  it("開催済みが無ければ null", () => {
    expect(profileStats([held("2026-12-01"), held("2026-09-01", "DRAFT")], TODAY)).toBeNull();
  });
});

describe("profileContentFromDraft", () => {
  it("未入力は null に寄せる", () => {
    const content = profileContentFromDraft(draft({ headline: "  ", bio: "", area: "  " }), null);

    expect(content.headline).toBeNull();
    expect(content.bio).toBeNull();
    expect(content.area).toBeNull();
  });

  it("showStats がオフなら実績を出さない", () => {
    const content = profileContentFromDraft(draft({ showStats: false }), { eventCount: 3, sinceYear: 2024 });

    expect(content.stats).toBeNull();
  });

  it("showStats がオンなら実績を出す", () => {
    const content = profileContentFromDraft(draft({ showStats: true }), { eventCount: 3, sinceYear: 2024 });

    expect(content.stats).toEqual({ eventCount: 3, sinceYear: 2024 });
  });
});

describe("profileIsPublished", () => {
  it("行が無ければ非公開として扱う", () => {
    expect(profileIsPublished(null)).toBe(false);
  });

  it("isPublished をそのまま返す", () => {
    expect(profileIsPublished({ isPublished: false })).toBe(false);
    expect(profileIsPublished({ isPublished: true })).toBe(true);
  });
});

describe("normalizeProfileTags", () => {
  it("固定リストの値だけを残す", () => {
    expect(normalizeProfileTags(["MUSIC", "unknown", "FOOD"])).toEqual(["MUSIC", "FOOD"]);
  });

  it("重複を落とす", () => {
    expect(normalizeProfileTags(["MUSIC", "MUSIC"])).toEqual(["MUSIC"]);
  });

  it("null は空配列", () => {
    expect(normalizeProfileTags(null)).toEqual([]);
  });
});

describe("profileBioExcerpt", () => {
  it("改行を空白にして1行にまとめる", () => {
    expect(profileBioExcerpt("月いちで\n読書会を開いています")).toBe("月いちで 読書会を開いています");
  });

  it("長いときは末尾を省略する", () => {
    const excerpt = profileBioExcerpt("あ".repeat(200), 10);

    expect(excerpt).toHaveLength(10);
    expect(excerpt?.endsWith("…")).toBe(true);
  });

  it("空なら null", () => {
    expect(profileBioExcerpt("   ")).toBeNull();
    expect(profileBioExcerpt(null)).toBeNull();
  });
});

describe("profileInitial", () => {
  it("先頭の1文字を返す", () => {
    expect(profileInitial("山田 太郎")).toBe("山");
  });

  it("空なら代わりの1文字を返す", () => {
    expect(profileInitial("   ")).toBe("主");
  });
});

describe("公開ページの URL", () => {
  it("旧・催しページの月を、統合ページのクエリへ引き継ぐ", () => {
    expect(organizerProfileRedirectPath("user-123", "2026-11")).toBe("/organizers/user-123?month=2026-11");
  });
});

describe("OrganizerProfileSchema", () => {
  it("未入力は既定値と null に寄せる", () => {
    const parsed = OrganizerProfileSchema.parse({});

    expect(parsed).toEqual({
      isPublished: false,
      headline: null,
      bio: null,
      area: null,
      tags: [],
      xUrl: null,
      instagramUrl: null,
      websiteUrl: null,
      lineUrl: null,
      showStats: false,
    });
  });

  it("前後の空白を落とし、改行コードを揃える", () => {
    const parsed = OrganizerProfileSchema.parse({
      headline: "  渋谷で読書会  ",
      bio: "  1行目\r\n2行目  ",
    });

    expect(parsed.headline).toBe("渋谷で読書会");
    expect(parsed.bio).toBe("1行目\n2行目");
  });

  it("ジャンルは重複を落とす", () => {
    const parsed = OrganizerProfileSchema.parse({ tags: ["MUSIC", "MUSIC", "FOOD"] });

    expect(parsed.tags).toEqual(["MUSIC", "FOOD"]);
  });

  it("ジャンルは3つまで", () => {
    const result = OrganizerProfileSchema.safeParse({ tags: ["MUSIC", "FOOD", "LEARNING", "SPORTS"] });

    expect(result.success).toBe(false);
  });

  it("固定リストに無いジャンルは受け付けない", () => {
    expect(OrganizerProfileSchema.safeParse({ tags: ["UNKNOWN"] }).success).toBe(false);
  });

  it("自己紹介は400文字まで", () => {
    expect(OrganizerProfileSchema.safeParse({ bio: "あ".repeat(400) }).success).toBe(true);
    expect(OrganizerProfileSchema.safeParse({ bio: "あ".repeat(401) }).success).toBe(false);
  });

  it("http の URL は受け付けない", () => {
    const result = OrganizerProfileSchema.safeParse({ websiteUrl: "http://example.com" });

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0].message).toContain("https://");
  });

  it("LINE は lin.ee と line.me だけを受け付ける", () => {
    expect(OrganizerProfileSchema.safeParse({ lineUrl: "https://lin.ee/abc" }).success).toBe(true);
    expect(OrganizerProfileSchema.safeParse({ lineUrl: "https://example.com/line" }).success).toBe(false);
  });

  it("知らない項目は受け付けない", () => {
    expect(OrganizerProfileSchema.safeParse({ name: "別名" }).success).toBe(false);
  });
});
