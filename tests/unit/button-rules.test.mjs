// ボタンの押せる的と文字の大きさを固定する。
//
// 参加者はスマホで開くので、押せる的は 44px を下回らせず、ボタンの文字は 15px を
// 下回らせない（AGENTS.md「画面の組み方」、docs/front_implementation_spec.md §1.2）。
// `.btn--sm` は左右の余白だけを詰める指定で、高さと文字は既定のままにする。
// ここが崩れると、狭い画面で 4 つを 1 段に収めるために文字を 12px まで落とす
// 書き方が戻ってきます。並びは段（`grid-template-columns`）を変えて収めます。
// 例外は画面下に固定する帯（`.action-dock`）だけで、40px・14px まで詰めます
// （一覧の上にずっと乗るため）。それでも 40px は下回らせません。
//
// 値を変えるときは src/styles/tokens.css と、この期待値を同じ PR で直します。

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const ROOT = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));

/** 改行をそろえて読み、宣言の並びを比べやすくする。 */
function read(relative) {
  return readFileSync(path.join(ROOT, relative), "utf8").replace(/\r\n/g, "\n");
}

/** `selector {` から対応する `}` までを取り出す。行頭の規則だけを見る。 */
function block(source, selector) {
  // セレクタは 1 行で書くものと、`,` で折り返すものがある。折り返しの字下げは無視する。
  const pattern = selector
    .split("\n")
    .map((line) => line.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("[ \\t]*\\n[ \\t]*");
  const rule = new RegExp(`^[ \\t]*${pattern}[ \\t]*\\{`, "m").exec(source);
  if (rule === null) return null;
  const open = rule.index + rule[0].length - 1;
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(open + 1, index);
    }
  }
  return null;
}

/** `@media (min-width: Npx)` の中にある `selector` の宣言だけを取り出す。
    同じ幅の `@media` は複数あるので、その `selector` を持つものを探す。 */
function wideBlock(source, width, selector) {
  const needle = `@media (min-width: ${width}px) {`;
  for (let start = source.indexOf(needle); start !== -1; start = source.indexOf(needle, start + 1)) {
    const open = start + needle.length - 1;
    let depth = 0;
    for (let index = open; index < source.length; index += 1) {
      if (source[index] === "{") depth += 1;
      if (source[index] === "}") {
        depth -= 1;
        if (depth === 0) {
          const found = block(source.slice(open + 1, index), selector);
          if (found !== null) return found;
          break;
        }
      }
    }
  }
  return null;
}

/** 宣言を `{ プロパティ: 値 }` にする。1 行 1 宣言だけを見る。 */
function declarations(body) {
  const found = {};
  for (const line of (body ?? "").split("\n")) {
    const match = line.match(/^\s*([a-z-]+):\s*([^;]+);/);
    if (match) found[match[1]] = match[2].trim();
  }
  return found;
}

const tokens = read("src/styles/tokens.css");
const components = read("src/styles/components.css");
const decoBase = read("src/styles/deco/base.css");
const surface = read("src/styles/deco/surface.css");
const organizer = read("src/styles/screens/organizer.css");

describe("ボタンの押せる的と文字", () => {
  it("44px と 15px をトークンで持つ", () => {
    expect(tokens).toContain("--tap-target: 2.75rem;");
    expect(tokens).toContain("--font-action: 0.9375rem;");
  });

  it("画面下の帯だけ 40px・14px まで詰める", () => {
    expect(tokens).toContain("--tap-target-dock: 2.5rem;");
    expect(tokens).toContain("--font-action-dock: 0.875rem;");
  });

  it(".btn は 44px 以上・15px・指の操作向けに固定する", () => {
    const btn = declarations(block(components, ".btn"));
    expect(btn["min-height"]).toBe("var(--tap-target)");
    expect(btn["font-size"]).toBe("var(--font-action)");
    expect(btn["line-height"]).toBe("1.4");
    expect(btn["touch-action"]).toBe("manipulation");
  });

  it(".btn--sm は左右の余白だけを詰め、高さと文字を変えない", () => {
    const body = block(components, ".btn--sm");
    expect(body).not.toBeNull();
    expect(body).toMatch(/padding:/);
    expect(body).not.toMatch(/\bmin-height\b/);
    expect(body).not.toMatch(/\bfont-size\b/);
  });

  it(".btn--lg は 52px・16px まで広げる", () => {
    const btn = declarations(block(components, ".btn--lg"));
    expect(btn["min-height"]).toBe("3.25rem");
    expect(btn["font-size"]).toBe("1rem");
  });

  it("飾りのある画面のボタンも高さと文字を打ち消さない", () => {
    const btn = block(decoBase, ".deco .btn");
    expect(btn).not.toBeNull();
    expect(btn).not.toMatch(/\bmin-height\b/);
    expect(btn).not.toMatch(/\bfont-size\b/);

    const small = block(decoBase, ".deco .btn--sm");
    expect(small).not.toBeNull();
    expect(small).not.toMatch(/\bmin-height\b/);
    expect(small).not.toMatch(/\bfont-size\b/);
  });
});

describe("入力欄と小さな操作", () => {
  it("入力欄はスマホ 16px、広い画面だけ 14px に詰める", () => {
    const field = declarations(block(components, ".input,\n.textarea,\n.select"));
    expect(field["min-height"]).toBe("var(--tap-target)");
    expect(field["font-size"]).toBe("1rem");

    const wide = declarations(wideBlock(components, 640, ".input,\n.textarea,\n.select"));
    expect(wide["font-size"]).toBe("0.875rem");
  });

  it("ダイアログの閉じる印は 44×44", () => {
    const close = declarations(block(components, ".dialog__close"));
    expect(close.width).toBe("var(--tap-target)");
    expect(close.height).toBe("var(--tap-target)");
  });

  it("暦の移動ボタンは 44×44・15px", () => {
    const nav = declarations(block(surface, ".cal__nav button"));
    expect(nav["min-width"]).toBe("var(--tap-target)");
    expect(nav["min-height"]).toBe("var(--tap-target)");
    expect(nav["font-size"]).toBe("var(--font-action)");
  });

  it("通知と名簿の行内操作も 44px を下回らない", () => {
    expect(declarations(block(organizer, ".notif__title a"))["min-height"]).toBe("var(--tap-target)");
    expect(declarations(block(organizer, ".notif__actions")).gap).toBe("0.5rem");
  });
});

describe("操作の並び", () => {
  it("イベント札の操作はスマホ 2 列、640px で 4 列、900px で 2 列", () => {
    const phone = declarations(block(surface, ".event-card > .event-card__actions"));
    expect(phone["grid-template-columns"]).toBe("repeat(2, minmax(0, 1fr))");

    const middle = declarations(
      wideBlock(surface, 640, ".event-card > .event-card__actions"),
    );
    expect(middle["grid-template-columns"]).toBe("repeat(4, minmax(0, 1fr))");

    const wide = declarations(wideBlock(surface, 900, ".event-card > .event-card__actions"));
    expect(wide["grid-template-columns"]).toBe("repeat(2, minmax(0, 1fr))");

    const btn = declarations(block(surface, ".event-card > .event-card__actions .btn"));
    expect(btn["min-height"]).toBe("var(--tap-target)");
    expect(btn["font-size"]).toBe("var(--font-action)");
  });

  it("名簿の行の操作はスマホ 2 列、640px から横並び", () => {
    const phone = declarations(block(organizer, ".roster .btn-row"));
    expect(phone.display).toBe("grid");
    expect(phone["grid-template-columns"]).toBe("repeat(2, minmax(0, 1fr))");

    const wide = declarations(wideBlock(organizer, 640, ".roster .btn-row"));
    expect(wide.display).toBe("flex");
  });

  it("画面下の帯は 40px、プロフィールの保存は 44px を下回らない", () => {
    const dock = declarations(block(organizer, ".action-dock .btn"));
    expect(dock["min-height"]).toBe("var(--tap-target-dock)");
    expect(dock["font-size"]).toBe("var(--font-action-dock)");
    expect(declarations(block(organizer, ".profile-actions .btn"))["min-height"]).toBe(
      "var(--tap-target)",
    );
  });
});
