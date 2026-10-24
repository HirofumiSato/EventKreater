// CSS とマークアップの突き合わせの仕様。
// scripts/lib/ui-css.mjs を直接読み込み、抽出の規則だけを固定する。

import { describe, expect, it } from "vitest";
import path from "node:path";

import {
  analyzeCssUsage,
  classNameValues,
  collectCssClasses,
  collectCssImports,
  collectTsxUsage,
  expandCssLinks,
  splitClassTokens,
  stylesheetLinks,
} from "../../scripts/lib/ui-css.mjs";

const usage = (source) => collectTsxUsage(source);

describe("CSS からクラス名を拾う", () => {
  it("セレクタの . の後ろを取る", () => {
    const classes = collectCssClasses(".btn { color: red } .btn--primary:hover { color: blue }");
    expect([...classes]).toEqual(["btn", "btn--primary"]);
  });

  it("@media の中も拾う", () => {
    const classes = collectCssClasses("@media (max-width: 640px) { .panel { display: block } }");
    expect([...classes]).toEqual(["panel"]);
  });

  it("値の中の . は拾わない", () => {
    const classes = collectCssClasses(".x { background: url(./a.png); grid-template: .5fr 1fr }");
    expect([...classes]).toEqual(["x"]);
  });

  it("コメントの中の .example は定義と数えない", () => {
    const classes = collectCssClasses("/* .dead は使わない */ .live { color: red }");
    expect([...classes]).toEqual(["live"]);
  });

  it("BOM が付いていても先頭のセレクタを落とさない", () => {
    const classes = collectCssClasses("\uFEFF.root { color: red }");
    expect([...classes]).toEqual(["root"]);
  });

  it(":root と要素セレクタはクラスではない", () => {
    expect([...collectCssClasses(":root { --a: 1 } body { margin: 0 }")]).toEqual([]);
  });
});

describe("className の値を読む", () => {
  it("文字列をそのまま取る", () => {
    expect(classNameValues('<div className="a b" />')).toEqual(["a b"]);
  });

  it("テンプレートの ${} を残す", () => {
    expect(classNameValues("<div className={`badge badge--${tone}`} />")).toEqual(["badge badge--${tone}"]);
  });

  it("三項演算子の中の文字列を取る", () => {
    expect(classNameValues('<div className={ok ? "alert alert--error" : "alert"} />')).toEqual([
      "alert alert--error",
      "alert",
    ]);
  });

  it("入れ子の波括弧があっても壊れない", () => {
    const source = '<div className={cn("panel", { "panel--open": open })} />';
    expect(classNameValues(source)).toEqual(["panel", "panel--open"]);
  });
});

describe("語の割り方", () => {
  it("動的な続きは接頭辞として扱う", () => {
    expect(splitClassTokens("badge badge--${tone}")).toEqual({ tokens: ["badge"], prefixes: ["badge--"] });
  });

  it("is- も接頭辞になる", () => {
    expect(splitClassTokens("cal__day is-${state}")).toEqual({ tokens: ["cal__day"], prefixes: ["is-"] });
  });

  it("三項で選ばれるクラスは語として取る", () => {
    expect(splitClassTokens("btn btn--primary").tokens).toEqual(["btn", "btn--primary"]);
  });
});

describe("突き合わせ", () => {
  const sheets = [
    { file: "a.css", kind: "shared", classes: new Set(["btn", "badge", "badge--success", "only-mock"]) },
  ];
  const noBaseline = { missing: {}, mockOnly: {}, unused: {} };

  it("製品が使うのに未定義のクラスを報告する", () => {
    const report = analyzeCssUsage({
      sheets: [{ file: "a.css", kind: "shared", classes: new Set(["btn"]) }],
      tsx: usage('<div className="btn ghost" />'),
      pages: [],
      baseline: noBaseline,
    });
    expect(report.missing.map((entry) => entry.name)).toEqual(["ghost"]);
  });

  it("動的な接頭辞が覆うクラスは未定義と報告しない", () => {
    const report = analyzeCssUsage({
      sheets: [{ file: "a.css", kind: "shared", classes: new Set(["badge--success"]) }],
      tsx: usage("<div className={`badge--${tone}`} />"),
      pages: [],
      baseline: noBaseline,
    });
    expect(report.missing).toEqual([]);
    expect(report.unused).toEqual([]);
  });

  it("モック専用 CSS にしか無いクラスを製品が使ったら報告する", () => {
    const report = analyzeCssUsage({
      sheets: [
        { file: "shared.css", kind: "shared", classes: new Set(["btn"]) },
        { file: "mock.css", kind: "mock", classes: new Set(["mockbar"]) },
      ],
      tsx: usage('<div className="mockbar" />'),
      pages: [],
      baseline: noBaseline,
    });
    expect(report.mockOnly.map((entry) => entry.name)).toEqual(["mockbar"]);
  });

  it("使われていないクラスを報告する", () => {
    const report = analyzeCssUsage({
      sheets,
      tsx: usage('<div className="btn badge" />'),
      pages: [],
      baseline: noBaseline,
    });
    expect(report.unused.map((entry) => entry.name)).toEqual(["badge--success", "only-mock"]);
  });

  it("台帳に載っている項目は報告しない", () => {
    const report = analyzeCssUsage({
      sheets,
      tsx: usage('<div className="btn badge" />'),
      pages: [],
      baseline: { missing: {}, mockOnly: {}, unused: { "only-mock": "理由" } },
    });
    expect(report.unused.map((entry) => entry.name)).toEqual(["badge--success"]);
  });

  it("モックは自分が読む CSS だけで判定する", () => {
    const page = {
      file: "p.html",
      classNames: new Set(["btn", "mockbar"]),
      prefixes: new Set(),
      words: new Set(["btn", "mockbar"]),
      reachable: new Set(["shared.css"]),
    };
    const report = analyzeCssUsage({
      sheets: [
        { file: "shared.css", kind: "shared", classes: new Set(["btn"]) },
        { file: "mock.css", kind: "mock", classes: new Set(["mockbar"]) },
      ],
      tsx: usage('<div className="btn" />'),
      pages: [page],
      baseline: noBaseline,
    });
    expect(report.missing.map((entry) => entry.name)).toEqual(["mockbar"]);
  });
});

describe("@import を辿る", () => {
  it("link の href を HTML からの相対で解決する", () => {
    const html = path.resolve("style-guide", "mock-home.html");
    const links = stylesheetLinks(
      html,
      '<link rel="stylesheet" href="../src/styles/index.css"><link rel="stylesheet" href="mock.css">',
    );
    expect(links).toEqual([
      path.resolve("src", "styles", "index.css"),
      path.resolve("style-guide", "mock.css"),
    ]);
  });

  it("外部の @import は辿らない", () => {
    const file = path.resolve("src", "styles", "index.css");
    expect(collectCssImports(file, '@import "./tokens.css";\n@import url("https://example.com/a.css");')).toEqual([
      path.resolve("src", "styles", "tokens.css"),
    ]);
  });

  it("入口から層をすべて集める", () => {
    const reachable = expandCssLinks(
      ["index.css"],
      new Map([
        ["index.css", ["tokens.css", "components.css"]],
        ["components.css", ["deco/pop.css"]],
      ]),
    );
    expect([...reachable].sort()).toEqual(["components.css", "deco/pop.css", "index.css", "tokens.css"]);
  });
});
