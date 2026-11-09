// 主催者マイページの操作ガイドの見た目の契約。
//
// 直した見た目は 3 つ。どれも 1 行の指定が消えると元に戻る。
//   1. 紙は公開ページの白（`--color-surface`）で、上辺に山吹のテープを貼る
//   2. 何枚目かの札は山吹の地に墨の字（`--pop-warm` と `--tape-ink`）
//   3. 黒面は 48 のまま、紙は 3 枚目のユーザーメニュー（60）より上に置く。位置は上書きしない
//
// 画面を開かずに読むのは、390px の撮影（`npm run mock:sync`）を待たずに
// 色と重なりを固定するため。書き方は `tests/unit/event-guide-styles.test.mjs` に倣う。

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const ROOT = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));

/** コメントを落としてから読む。`/* … *\/` が混ざるとセレクタの切り出しが崩れる。 */
function readStyles(relative) {
  return readFileSync(path.join(ROOT, relative), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
}

const ORGANIZER = readStyles("src/styles/screens/organizer.css");
const COMPONENTS = readStyles("src/styles/components.css");
const BASE = readStyles("src/styles/base.css");

/** 指定したセレクタの宣言をすべてつなげて返す（同じセレクタが複数あれば全部）。 */
function declarations(source, selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`(?:^|\\n)\\s*${escaped}\\s*\\{([^}]*)\\}`, "g");
  const bodies = [];
  for (const match of source.matchAll(pattern)) bodies.push(match[1]);
  return bodies.join("\n");
}

/** `z-index` の数値。見つからなければ NaN。 */
function zIndex(source, selector) {
  const found = /z-index:\s*(\d+)/.exec(declarations(source, selector));
  return found ? Number(found[1]) : Number.NaN;
}

describe("公開ページの紙に寄せた地", () => {
  it("地は公開ページの白（`--color-surface`）にする", () => {
    expect(declarations(ORGANIZER, ".guide-bubble--paper")).toContain(
      "background: var(--color-surface)",
    );
  });

  it("上辺に山吹のテープを貼る（`::before`）", () => {
    const body = declarations(ORGANIZER, ".guide-bubble--paper::before");

    expect(body).toContain('content: ""');
    expect(body).toContain("position: absolute");
    // 山吹を薄く敷く。地の白に沈まない濃さで、文字は載せない。
    expect(body).toMatch(/background: rgb\(224 155 22 \/ 0?\.\d+\)/);
    expect(body).toContain("transform: translateX(-50%) rotate(");
    // テープは飾りで、対象の操作を邪魔しない。
    expect(body).toContain("pointer-events: none");
  });

  it("何枚目かの札は山吹の地に墨の字にする", () => {
    const body = declarations(ORGANIZER, ".guide-bubble--paper .guide-bubble__step");

    expect(body).toContain("background: var(--pop-warm)");
    expect(body).toContain("color: var(--tape-ink)");
    // 右上の閉じる印（40px）の下へ文字を潜らせない。
    expect(body).toContain("padding-inline-end: 2.25rem");
  });

  it("見出しの下線も山吹の 2px にする", () => {
    expect(declarations(ORGANIZER, ".guide-bubble--paper .guide-bubble__title")).toContain(
      "border-bottom: 2px solid var(--pop-warm)",
    );
  });

  it("箇条書きの点は 1 段濃い山吹にする（白地に沈ませない）", () => {
    expect(
      declarations(ORGANIZER, ".guide-bubble--paper .guide-bubble__list li::marker"),
    ).toContain("color: var(--pop-warm-deep)");
  });
});

describe("重なりは既存のガイドのまま", () => {
  it("黒い面は 48 で、画面下の帯より上・モーダルより下に置く", () => {
    const scrim = zIndex(ORGANIZER, ".guide-scrim");
    const bar = zIndex(COMPONENTS, ".form-final");
    const modal = zIndex(COMPONENTS, ".modal");

    expect(scrim).toBe(48);
    expect(bar).toBe(40);
    expect(modal).toBe(50);
    expect(scrim).toBeGreaterThan(bar);
    expect(scrim).toBeLessThan(modal);
  });

  it("紙は黒い面より 1 段上（49）に置く", () => {
    expect(zIndex(ORGANIZER, ".guide-bubble")).toBe(zIndex(ORGANIZER, ".guide-scrim") + 1);
  });

  it("紙の地を変えても、位置は上書きしない", () => {
    const body = declarations(ORGANIZER, ".guide-bubble--paper");

    // `position: fixed` は `.guide-bubble` が持つ。ここで足すと `::before` の基準も動く。
    expect(body).not.toContain("position:");
  });

  it("紙は 3 枚目に開くユーザーメニュー（60）より上に置く", () => {
    // 49 のままだとメニューが紙に重なり、文が読めないうえ「次へ」の押下も奪われる。
    const paper = zIndex(ORGANIZER, ".guide-bubble--paper");
    const menu = zIndex(BASE, ".site-user-menu");

    expect(menu).toBe(60);
    expect(paper).toBeGreaterThan(menu);
    // 黒い面（48）より上にあること。
    expect(paper).toBeGreaterThan(zIndex(ORGANIZER, ".guide-scrim"));
  });
});
