// テーマの ID（TypeScript）と CSS の対応表がずれていないことを固定する。
//
// 色の実体は src/styles/themes.css が正で、ID の一覧は src/lib/semantic-themes.ts が正です。
// テーマを足したときに片方だけ直すと、選べるのに色が付かない（またはその逆）状態になります。
// 公開ページの速度のため、テーマは属性と静的 CSS だけで、ぼかしもアニメーションも使いません。

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { SEMANTIC_THEME_IDS } from "@/lib/semantic-themes";

const ROOT = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const THEMES_CSS = readFileSync(path.join(ROOT, "src/styles/themes.css"), "utf8");
const INDEX_CSS = readFileSync(path.join(ROOT, "src/styles/index.css"), "utf8");

/** テーマが必ず持つトークン。1 つ欠けると、その部品だけ色が継承元へ落ちる。 */
const REQUIRED_TOKENS = [
  "--st-surface-base",
  "--st-surface-raised",
  "--st-content-primary",
  "--st-content-secondary",
  "--st-accent-primary",
  "--st-accent-contrast",
  "--st-border-width",
  "--st-border-color",
  "--st-radius-base",
  "--st-shadow-elevation",
];

/** `[data-semantic-theme="..."]` のブロックの中身を取り出す。 */
function themeBlock(id: string): string {
  const start = THEMES_CSS.indexOf(`[data-semantic-theme="${id}"]`);
  expect(start, `${id} のブロックが themes.css にありません`).toBeGreaterThanOrEqual(0);
  const open = THEMES_CSS.indexOf("{", start);
  const close = THEMES_CSS.indexOf("}", open);
  return THEMES_CSS.slice(open + 1, close);
}

describe("セマンティックテーマの CSS", () => {
  it("すべてのテーマに [data-semantic-theme] のブロックがある", () => {
    for (const id of SEMANTIC_THEME_IDS) {
      expect(themeBlock(id).length).toBeGreaterThan(0);
    }
  });

  it("すべてのテーマが必須トークンを持つ", () => {
    for (const id of SEMANTIC_THEME_IDS) {
      const block = themeBlock(id);
      const missing = REQUIRED_TOKENS.filter((token) => !block.includes(`${token}:`));
      expect(missing, `${id} に足りないトークン`).toEqual([]);
    }
  });

  it("themes.css は index.css の最後に読む（装飾より後）", () => {
    const imports = [...INDEX_CSS.matchAll(/@import\s+"([^"]+)";/g)].map((match) => match[1]);
    expect(imports.at(-1)).toBe("./themes.css");
  });

  it("公開ページにぼかしとアニメーションを持ち込まない", () => {
    expect(THEMES_CSS).not.toMatch(/backdrop-filter\s*:/);
    expect(THEMES_CSS).not.toMatch(/[^-]animation\s*:/);
    expect(THEMES_CSS).not.toMatch(/@keyframes/);
  });

  it("全幅の面は負のマージンで画面端まで広げる", () => {
    expect(THEMES_CSS).toMatch(/\.semantic-theme--page\s*\{[^}]*margin-inline:\s*calc\(50% - 50vw\)/);
  });
});
