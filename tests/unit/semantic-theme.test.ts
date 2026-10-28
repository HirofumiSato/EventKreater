import { describe, expect, it } from "vitest";
import {
  SEMANTIC_THEMES,
  SEMANTIC_THEME_IDS,
  isSemanticThemeId,
  normalizeSemanticThemeId,
  semanticTheme,
} from "@/lib/semantic-themes";
import { OrganizerProfileSchema } from "@/lib/schemas";

describe("SEMANTIC_THEMES", () => {
  it("初期は 5 つ。ID は重複しない", () => {
    expect(SEMANTIC_THEME_IDS).toHaveLength(5);
    expect(new Set(SEMANTIC_THEME_IDS).size).toBe(5);
    expect(SEMANTIC_THEMES.map((theme) => theme.id)).toEqual([...SEMANTIC_THEME_IDS]);
  });

  it("表示名と説明が空でない", () => {
    for (const theme of SEMANTIC_THEMES) {
      expect(theme.label.trim()).not.toBe("");
      expect(theme.note.trim()).not.toBe("");
    }
  });

  it("ID は CSS の属性値に使える小文字とハイフンだけ", () => {
    for (const id of SEMANTIC_THEME_IDS) {
      expect(id).toMatch(/^[a-z][a-z0-9-]*$/);
    }
  });
});

describe("normalizeSemanticThemeId", () => {
  it("一覧にある ID はそのまま返す", () => {
    expect(normalizeSemanticThemeId("neon")).toBe("neon");
    expect(normalizeSemanticThemeId("parchment")).toBe("parchment");
  });

  it("未選択・空文字・知らない ID は null", () => {
    expect(normalizeSemanticThemeId(null)).toBeNull();
    expect(normalizeSemanticThemeId(undefined)).toBeNull();
    expect(normalizeSemanticThemeId("")).toBeNull();
    expect(normalizeSemanticThemeId("Neon")).toBeNull();
    expect(normalizeSemanticThemeId("neon ")).toBeNull();
  });

  it("isSemanticThemeId は型を絞る", () => {
    expect(isSemanticThemeId("modern-slate")).toBe(true);
    expect(isSemanticThemeId("unknown")).toBe(false);
  });

  it("semanticTheme は定義を返し、知らない ID は null", () => {
    expect(semanticTheme("parchment")?.label).toBe("羊皮紙");
    expect(semanticTheme("unknown")).toBeNull();
    expect(semanticTheme(null)).toBeNull();
  });
});

describe("OrganizerProfileSchema のテーマ", () => {
  it("5 テーマと null を受け付ける", () => {
    for (const id of SEMANTIC_THEME_IDS) {
      expect(OrganizerProfileSchema.parse({ themeId: id }).themeId).toBe(id);
    }
    expect(OrganizerProfileSchema.parse({ themeId: null }).themeId).toBeNull();
  });

  it("未指定なら null（標準の見た目）", () => {
    expect(OrganizerProfileSchema.parse({}).themeId).toBeNull();
  });

  it("知らないテーマは弾く", () => {
    expect(() => OrganizerProfileSchema.parse({ themeId: "midnight" })).toThrow();
  });
});
