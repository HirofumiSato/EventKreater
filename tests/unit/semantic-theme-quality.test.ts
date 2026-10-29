// テーマの「質」を機械で止める 4 つのゲート。
//
// 1. コントラスト  … 地・面・差し色・状態色の組み合わせが読めるか（WCAG 2.1 の相対輝度）
// 2. 網羅性        … 参照したトークンに既定値があるか、死んだトークンを残していないか
// 3. テーマ固有規則 … `[data-semantic-theme="x"] .card` のような特例を書いていないか
// 4. 近接テーマ    … 色だけを変えた「同じ紙」が 2 つ並んでいないか
//
// 色の正は src/styles/themes.css、ID の正は src/lib/semantic-themes.ts。
// この試験はブラウザも DB も使わず、CSS を読んで計算するだけ。

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { SEMANTIC_THEME_IDS } from "@/lib/semantic-themes";

const ROOT = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const CSS = readFileSync(path.join(ROOT, "src/styles/themes.css"), "utf8");
const SOURCE = CSS.replace(/\/\*[\s\S]*?\*\//g, "");

type Rgba = { r: number; g: number; b: number; a: number };
type Tokens = Record<string, string>;
type Rule = { selector: string; body: string };

const WHITE: Rgba = { r: 255, g: 255, b: 255, a: 1 };

/** 入れ子（`@media`）を 1 つの規則として扱う、素朴な区切り。 */
function ruleBlocks(css: string): Rule[] {
  const rules: Rule[] = [];
  let depth = 0;
  let selectorStart = 0;
  let selector = "";
  let bodyStart = -1;
  for (let i = 0; i < css.length; i += 1) {
    const char = css[i];
    if (char === "{") {
      if (depth === 0) {
        selector = css.slice(selectorStart, i).trim();
        bodyStart = i + 1;
      }
      depth += 1;
      continue;
    }
    if (char === "}") {
      depth -= 1;
      if (depth === 0 && bodyStart >= 0) {
        rules.push({ selector, body: css.slice(bodyStart, i) });
        bodyStart = -1;
        selectorStart = i + 1;
      }
    }
  }
  return rules;
}

const RULES = ruleBlocks(SOURCE);

/** 宣言だけを取り出す。値の改行とインデントは 1 つの空白に畳む。 */
function declarations(body: string): Tokens {
  const tokens: Tokens = {};
  for (const match of body.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/gi)) {
    tokens[match[1]] = match[2].trim().replace(/\s+/g, " ");
  }
  return tokens;
}

const THEME_SELECTOR = /^\[data-semantic-theme="([a-z0-9-]+)"\]$/;

const THEME_TOKENS = new Map<string, Tokens>(
  RULES.flatMap((rule) => {
    const match = THEME_SELECTOR.exec(rule.selector);
    return match ? [[match[1], declarations(rule.body)] as const] : [];
  }),
);

const DEFAULTS_RULE = RULES.find((rule) => rule.selector === ".semantic-theme");
const DEFAULTS = DEFAULTS_RULE ? declarations(DEFAULTS_RULE.body) : {};

function themeTokens(id: string): Tokens {
  return { ...DEFAULTS, ...(THEME_TOKENS.get(id) ?? {}) };
}

/** `#rrggbb` / `rgb(r g b / a)` / `var(--st-x)` / `color-mix(in srgb, ...)` を解く。 */
function color(value: string, tokens: Tokens, seen: Set<string> = new Set()): Rgba {
  const text = value.trim();

  const reference = /^var\((--[a-z0-9-]+)(?:,\s*([\s\S]+))?\)$/i.exec(text);
  if (reference) {
    const name = reference[1];
    expect(seen.has(name), `トークンの循環参照: ${name}`).toBe(false);
    const next = tokens[name];
    if (next === undefined) {
      expect(reference[2], `未定義のトークン: ${name}`).toBeTruthy();
      return color(reference[2] as string, tokens, new Set([...seen, name]));
    }
    return color(next, tokens, new Set([...seen, name]));
  }

  const mixed = /^color-mix\(\s*in srgb\s*,\s*([\s\S]+?)\s+([\d.]+)%\s*,\s*([\s\S]+)\)$/i.exec(text);
  if (mixed) {
    const first = color(mixed[1], tokens, seen);
    const second = color(mixed[3], tokens, seen);
    return blend(first, second, Number(mixed[2]) / 100);
  }

  const hex = /^#([0-9a-f]{6})$/i.exec(text);
  if (hex) {
    const packed = Number.parseInt(hex[1], 16);
    return { r: (packed >> 16) & 255, g: (packed >> 8) & 255, b: packed & 255, a: 1 };
  }

  const fn = /^rgba?\(([^)]+)\)$/i.exec(text);
  if (fn) {
    const parts = fn[1]
      .split(/[\s,/]+/)
      .filter(Boolean)
      .map(Number);
    return { r: parts[0], g: parts[1], b: parts[2], a: parts[3] ?? 1 };
  }

  throw new Error(`色として読めない値: ${text}`);
}

/** `first` を p、`second` を 1-p で混ぜる（color-mix in srgb と同じ）。 */
function blend(first: Rgba, second: Rgba, p: number): Rgba {
  return {
    r: first.r * p + second.r * (1 - p),
    g: first.g * p + second.g * (1 - p),
    b: first.b * p + second.b * (1 - p),
    a: 1,
  };
}

/** 半透明を地の上に載せる。 */
function over(top: Rgba, bottom: Rgba): Rgba {
  return {
    r: top.r * top.a + bottom.r * (1 - top.a),
    g: top.g * top.a + bottom.g * (1 - top.a),
    b: top.b * top.a + bottom.b * (1 - top.a),
    a: 1,
  };
}

function luminance({ r, g, b }: Rgba): number {
  const channel = (value: number) => {
    const srgb = value / 255;
    return srgb <= 0.04045 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrast(a: Rgba, b: Rgba): number {
  const first = luminance(a);
  const second = luminance(b);
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}

/** テーマの色を、実際に画面へ出る値（地の上に載せた値）に直す。 */
function palette(id: string) {
  const tokens = themeTokens(id);
  const base = over(color(tokens["--st-surface-base"], tokens), WHITE);
  const raised = over(color(tokens["--st-surface-raised"], tokens), base);
  const onBase = (name: string) => over(color(tokens[name], tokens), base);
  return {
    base,
    raised,
    primary: onBase("--st-content-primary"),
    secondary: onBase("--st-content-secondary"),
    accent: over(color(tokens["--st-accent-primary"], tokens), base),
    accentText: onBase("--st-accent-text"),
    accentContrast: onBase("--st-accent-contrast"),
    borderStrong: onBase("--st-border-strong"),
    warning: onBase("--st-warning"),
    danger: onBase("--st-danger"),
    success: onBase("--st-success"),
  };
}

/** 文字色として地・面に載せたときの最小比。 */
function readable(id: string, token: string, minimum: number) {
  const tokens = themeTokens(id);
  const { base, raised } = palette(id);
  const text = over(color(tokens[token], tokens), base);
  expect(contrast(text, base), `${id}: ${token} / 地`).toBeGreaterThanOrEqual(minimum);
  expect(contrast(text, raised), `${id}: ${token} / 面`).toBeGreaterThanOrEqual(minimum);
}

describe("コントラスト（読めるか）", () => {
  it("地と面の組み合わせがすべて決まっている", () => {
    expect([...THEME_TOKENS.keys()].sort()).toEqual([...SEMANTIC_THEME_IDS].sort());
  });

  it.each([...SEMANTIC_THEME_IDS])("%s: 本文は 7:1、補助文字は 4.5:1 以上", (id) => {
    readable(id, "--st-content-primary", 7);
    readable(id, "--st-content-secondary", 4.5);
  });

  it.each([...SEMANTIC_THEME_IDS])("%s: 差し色の上の字と、リンクの字が読める", (id) => {
    readable(id, "--st-accent-text", 4.5);
    const { accent, accentContrast } = palette(id);
    expect(contrast(accentContrast, accent), `${id}: 差し色の上の字`).toBeGreaterThanOrEqual(4.5);
  });

  it.each([...SEMANTIC_THEME_IDS])("%s: 押せる部品の境界が 3:1 以上", (id) => {
    const { base, raised, borderStrong } = palette(id);
    expect(contrast(borderStrong, base), `${id}: 境界 / 地`).toBeGreaterThanOrEqual(3);
    expect(contrast(borderStrong, raised), `${id}: 境界 / 面`).toBeGreaterThanOrEqual(3);
  });

  it.each([...SEMANTIC_THEME_IDS])("%s: 状態の文字（警告・危険・成功）が読める", (id) => {
    const tokens = themeTokens(id);
    const { raised, primary, warning, danger, success } = palette(id);
    const mixes: [string, Rgba, number][] = [
      ["--st-warning", warning, 0.68],
      ["--st-danger", danger, 0.74],
      ["--st-success", success, 0.72],
    ];
    for (const [name, state, weight] of mixes) {
      const text = blend(state, primary, weight);
      expect(contrast(text, raised), `${id}: ${name} の文字`).toBeGreaterThanOrEqual(4.5);
    }
    // 待ちの札は、地色を敷いて地の文字を載せる。
    const waitlist = over(color(tokens["--st-surface-base"], tokens), WHITE);
    expect(contrast(waitlist, warning), `${id}: 待ちの札の字`).toBeGreaterThanOrEqual(4.5);
  });
});

describe("網羅性（トークンの契約）", () => {
  const referenced = new Map<string, boolean>();
  for (const match of SOURCE.matchAll(/var\((--st-[a-z0-9-]+)(\s*,)?/gi)) {
    const hasFallback = Boolean(match[2]);
    referenced.set(match[1], (referenced.get(match[1]) ?? true) && hasFallback);
  }
  const declared = new Set<string>(
    [...Object.keys(DEFAULTS), ...[...THEME_TOKENS.values()].flatMap((tokens) => Object.keys(tokens))]
      .filter((name) => name.startsWith("--st-")),
  );

  it("参照しているトークンには、既定値かフォールバックがある", () => {
    const missing = [...referenced.entries()]
      .filter(([name, hasFallback]) => {
        if (hasFallback) return false;
        if (name in DEFAULTS) return false;
        // 全テーマが必ず書くものは、既定値を置かない（テーマの数だけ正を持つ）。
        return ![...SEMANTIC_THEME_IDS].every((id) => name in (THEME_TOKENS.get(id) ?? {}));
      })
      .map(([name]) => name);
    expect(missing).toEqual([]);
  });

  it("定義したトークンをすべてどこかで使う（死んだトークンを残さない）", () => {
    const dead = [...declared].filter((name) => !referenced.has(name)).sort();
    expect(dead).toEqual([]);
  });

  it("任意トークンは .semantic-theme に既定値を持つ", () => {
    for (const name of [
      "--st-font-heading",
      "--st-font-body",
      "--st-heading-weight",
      "--st-heading-tracking",
      "--st-stack-gap",
      "--st-content-width",
      "--st-border-strong",
    ]) {
      expect(DEFAULTS[name], `${name} の既定値`).toBeTruthy();
    }
  });
});

describe("テーマ固有の規則を持たない", () => {
  it("[data-semantic-theme=\"x\"] はトークン定義の 1 箇所だけに現れる", () => {
    const found = [...SOURCE.matchAll(/\[data-semantic-theme="([a-z0-9-]+)"\]/g)].map(
      (match) => match[1],
    );
    expect(found.sort()).toEqual([...SEMANTIC_THEME_IDS].sort());
  });

  it("トークン定義以外の規則にテーマ名を書かない", () => {
    const offenders = RULES.filter(
      (rule) => rule.selector.includes("[data-semantic-theme=") && !THEME_SELECTOR.test(rule.selector),
    ).map((rule) => rule.selector);
    expect(offenders).toEqual([]);
  });
});

describe("近接テーマ（色違いの水増しを止める）", () => {
  /** 地の明るさ・差し色の色相・角丸・表示書体・密度の 5 軸に落とす。 */
  function axes(id: string) {
    const tokens = themeTokens(id);
    const base = over(color(tokens["--st-surface-base"], tokens), WHITE);
    const accent = over(color(tokens["--st-accent-primary"], tokens), base);
    const radius = Number.parseFloat(tokens["--st-radius-base"]);
    const gap = Number.parseFloat(tokens["--st-stack-gap"]);
    const width = tokens["--st-content-width"].includes("--width-content")
      ? 42
      : Number.parseFloat(tokens["--st-content-width"]);
    const heading = tokens["--st-font-heading"];

    const font = /mincho|serif/i.test(heading)
      ? "明朝"
      : heading.includes("--font-display")
        ? "表示書体"
        : "角ゴシック";

    return {
      地: luminance(base) < 0.2 ? "暗い" : "明るい",
      差し色: Math.floor(hue(accent) / 30),
      角丸: radius <= 2 ? "角" : radius <= 7 ? "小" : radius <= 14 ? "中" : "大",
      書体: font,
      密度: `${gap <= 1.0625 ? "詰" : gap <= 1.375 ? "並" : "広"}/${width <= 40 ? "狭" : width >= 44 ? "広" : "並"}`,
    };
  }

  function hue({ r, g, b }: Rgba): number {
    const max = Math.max(r, g, b) / 255;
    const min = Math.min(r, g, b) / 255;
    const delta = max - min;
    if (delta === 0) return 0;
    const red = r / 255;
    const green = g / 255;
    const blue = b / 255;
    let degree = 0;
    if (max === red) degree = ((green - blue) / delta) % 6;
    else if (max === green) degree = (blue - red) / delta + 2;
    else degree = (red - green) / delta + 4;
    return (degree * 60 + 360) % 360;
  }

  it("5 軸のうち 4 つ以上が同じテーマの組は無い", () => {
    const near: string[] = [];
    for (let i = 0; i < SEMANTIC_THEME_IDS.length; i += 1) {
      for (let j = i + 1; j < SEMANTIC_THEME_IDS.length; j += 1) {
        const left = axes(SEMANTIC_THEME_IDS[i]);
        const right = axes(SEMANTIC_THEME_IDS[j]);
        const same = Object.keys(left).filter(
          (axis) => left[axis as keyof typeof left] === right[axis as keyof typeof right],
        );
        if (same.length >= 4) {
          near.push(`${SEMANTIC_THEME_IDS[i]} と ${SEMANTIC_THEME_IDS[j]}: ${same.join("・")}`);
        }
      }
    }
    expect(near).toEqual([]);
  });
});
