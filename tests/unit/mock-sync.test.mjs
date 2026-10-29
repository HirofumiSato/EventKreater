// モックの生成と同期の仕様。scripts/lib/mock-html.mjs / mock-hash.mjs / mock-screens.mjs /
// check-mock-sync.mjs を直接読み込む。ブラウザも DB も使わない。

import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  evaluateSync,
  missingInteractions,
  missingShell,
  missingVoiceSimulation,
  sha256,
  TOOL_FILES,
} from "../../scripts/check-mock-sync.mjs";
import { frameHtml, frameSrc, frameUrl } from "../../scripts/lib/mock-frame.mjs";
import { indexHtml, scopeOfHtml } from "../../scripts/lib/mock-index.mjs";
import {
  applyAssetMap,
  assetName,
  imageSources,
  matchLinkTarget,
  parseSrcset,
  rewriteInternalLinks,
  sanitizeHtml,
  stylesheetHrefs,
  withMockInteractions,
  withMockShell,
  withNotice,
} from "../../scripts/lib/mock-html.mjs";
import { computeUiHash, normalizeNewlines, uiSourceFiles } from "../../scripts/lib/mock-hash.mjs";
import { captureProblem, captureProblemMessage } from "../../scripts/lib/mock-found.mjs";
import {
  expectedFiles,
  linkTargets as buildLinkTargets,
  pageFileFor,
  pathFor,
  placeholderScreens,
  selectRows,
} from "../../scripts/lib/mock-screens.mjs";
import {
  mergeCalendarDays,
  mergeStepBodies,
  mergeVariants,
  readVariantCache,
  shouldReuseShots,
  sourceHashOf,
  variantsWanted,
  writeVariantCache,
} from "../../scripts/lib/mock-variants.mjs";
import { SEMANTIC_THEMES, SEMANTIC_THEME_IDS } from "@/lib/semantic-themes";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));

describe("製品の HTML をモックに整える", () => {
  it("script・コメント・nonce・Next の目印を落とし、lang と body のクラスは残す", () => {
    const input = `<!doctype html><html lang="ja"><head><script>window.__next = 1</script><link rel="stylesheet" href="/_next/static/css/a.css" nonce="abc123"><style>.a { color: red; }</style></head><body class="theme theme--dark"><div data-nextjs-scroll-focus-boundary="true">本文</div><!-- 区切り --><next-route-announcer></next-route-announcer></body></html>`;

    const html = sanitizeHtml(input);

    expect(html).not.toContain("<script");
    expect(html).not.toContain("nonce=");
    expect(html).not.toContain("data-nextjs-");
    expect(html).not.toContain("<!--");
    expect(html).not.toContain("next-route-announcer");
    expect(html).toContain('<html lang="ja">');
    expect(html).toContain('class="theme theme--dark"');
    expect(html).toContain("<style>.a { color: red; }</style>");
  });

  it("stylesheet のリンクだけを拾い、preconnect は拾わない", () => {
    const html = `<link rel="preconnect" href="https://fonts.gstatic.com"><link rel="stylesheet" href="/_next/static/css/app.css"><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Zen" crossorigin="">`;
    expect(stylesheetHrefs(html)).toEqual([
      "/_next/static/css/app.css",
      "https://fonts.googleapis.com/css2?family=Zen",
    ]);
  });

  it("Next の内部ファイルを先読みする link は落とし、stylesheet は残す", () => {
    const html = `<link rel="preload" as="script" href="/_next/static/chunks/webpack.js"><link rel="modulepreload" href="/_next/static/chunks/a.js"><link rel="stylesheet" href="/_next/static/css/app.css"><link rel="preconnect" href="https://fonts.gstatic.com">`;
    const cleaned = sanitizeHtml(html);
    expect(cleaned).not.toContain("webpack.js");
    expect(cleaned).not.toContain("/_next/static/chunks/a.js");
    expect(cleaned).toContain('href="/_next/static/css/app.css"');
    expect(cleaned).toContain('href="https://fonts.gstatic.com"');
  });

  it("src と srcset の両方から画像を集め、&amp; を戻す", () => {
    const html = `<img src="/_next/image?url=%2Fsamples%2Fa.jpg&amp;w=640&amp;q=75" srcset="/_next/image?url=x&amp;w=320 320w, /_next/image?url=x&amp;w=640 640w"><source srcset="/samples/b.webp 1x">`;
    const urls = imageSources(html);
    expect(urls).toContain("/_next/image?url=%2Fsamples%2Fa.jpg&w=640&q=75");
    expect(urls).toContain("/_next/image?url=x&w=320");
    expect(urls).toContain("/_next/image?url=x&w=640");
    expect(urls).toContain("/samples/b.webp");
  });

  it("CSS と画像を保存先へ差し替え、対応表に無いものは元のまま残す", () => {
    const html = `<link rel="stylesheet" href="/a.css"><link rel="stylesheet" href="https://fonts.example/x"><img src="/samples/a.jpg" srcset="/samples/a.jpg 1x, /samples/b.jpg 2x">`;
    const rewritten = applyAssetMap(html, {
      stylesheets: new Map([["/a.css", "assets/aaa.css"]]),
      images: new Map([["/samples/a.jpg", "assets/aaa.webp"]]),
    });

    expect(rewritten).toContain('href="assets/aaa.css"');
    expect(rewritten).toContain('href="https://fonts.example/x"');
    expect(rewritten).toContain('src="assets/aaa.webp"');
    expect(rewritten).toContain("srcset=\"assets/aaa.webp 1x, /samples/b.jpg 2x\"");
  });

  it("内部リンクは対応するモックへ、未知の内部リンクは # へ、外部はそのまま", () => {
    const html = [
      '<a href="/organizer/events">主催一覧</a>',
      '<a href="/organizer/events?tab=1">絞り込み</a>',
      '<a href="/unknown/path">未知</a>',
      '<a href="https://example.com/x">外部</a>',
      '<a href="#main">本文へ</a>',
      '<a href="mailto:a@example.com">メール</a>',
      '<a href="">空</a>',
    ].join("\n");

    const targets = new Map([["/organizer/events", "mock-organizer.html"]]);
    const rewritten = rewriteInternalLinks(html, targets);

    expect(rewritten).toContain('<a href="mock-organizer.html">主催一覧</a>');
    expect(rewritten).toContain('<a href="mock-organizer.html">絞り込み</a>');
    expect(rewritten).toContain('<a href="#">未知</a>');
    expect(rewritten).toContain('<a href="https://example.com/x">外部</a>');
    expect(rewritten).toContain('<a href="#main">本文へ</a>');
    expect(rewritten).toContain('<a href="mailto:a@example.com">メール</a>');
    expect(rewritten).toContain('<a href="#">空</a>');
  });

  it("注意書きは doctype の直後に入る", () => {    const html = withNotice("<!doctype html><html lang=\"ja\"></html>", {
      name: "ホーム",
      path: "/",
    });
    expect(html.startsWith("<!doctype html>\n<!--")).toBe(true);
    expect(html).toContain("npm run mock:sync");
    expect(html).toContain("画面: ホーム（/）");
  });

  it("doctype が無ければ補う（後方互換モードで描画させない）", () => {
    const html = withNotice('<html lang="ja"></html>', { name: "ホーム", path: "/" });
    expect(html.startsWith("<!doctype html>\n<!--")).toBe(true);
  });

  it("srcset を URL と説明に分ける", () => {
    expect(parseSrcset("/a 1x, /b 640w")).toEqual([
      { url: "/a", descriptor: "1x" },
      { url: "/b", descriptor: "640w" },
    ]);
  });

  it("素材の名前は内容で決まる（同じ内容なら同じ・変われば変わる）", () => {
    const first = assetName(Buffer.from("one"), ".css");
    expect(first).toBe(assetName(Buffer.from("one"), ".css"));
    expect(first).not.toBe(assetName(Buffer.from("two"), ".css"));
    expect(first).toMatch(/^[0-9a-f]{16}\.css$/);
  });
});

describe("モックだけの帯", () => {
  const html = "<!doctype html>\n<html lang=\"ja\"><head><meta charset=\"utf-8\"></head><body><main>本文</main></body></html>";

  it("head に CSS、body の末尾に data 付きの script を 1 つずつ足す", () => {
    const out = withMockShell(html, {
      file: "mock-home.html",
      name: "01 ホーム",
      path: "/",
      frame390: "mock-frame.html?p=mock-home.html&w=390",
      frame1280: "mock-frame.html?p=mock-home.html&w=1280",
    });

    expect(out).toContain('<link rel="stylesheet" href="mock-shell.css">');
    expect(out.match(/data-mock-shell/g)).toHaveLength(1);
    expect(out).toContain('src="mock-shell.js"');
    expect(out).toContain('data-name="01 ホーム"');
    expect(out).toContain('data-frame390="mock-frame.html?p=mock-home.html&amp;w=390"');
    // script は body の閉じタグの直前、CSS は head の閉じタグの直前。
    expect(out.indexOf("mock-shell.css")).toBeLessThan(out.indexOf("</head>"));
    expect(out.indexOf("mock-shell.js")).toBeLessThan(out.indexOf("</body>"));
  });

  it("二重には足さない", () => {
    const once = withMockShell(html, { file: "mock-a.html", name: "A" });
    const twice = withMockShell(once, { file: "mock-a.html", name: "A" });
    expect(twice).toBe(once);
  });

  it("画面名の記号を属性として壊さない", () => {
    const out = withMockShell(html, { file: 'mock-a.html"x', name: '<img src=x onerror=1>' });
    expect(out).not.toContain("<img src=x");
    expect(out).toContain('data-name="&lt;img src=x onerror=1&gt;"');
  });

  it("帯が無い HTML を検出する", () => {
    const contents = new Map([
      ["mock-home.html", withMockShell(html, { name: "01 ホーム" })],
      ["mock-service.html", html],
    ]);
    const problems = missingShell(["mock-home.html", "mock-service.html"], contents);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("mock-service.html");
    expect(problems[0]).toContain("mock:sync");
  });
});

describe("画面の一覧", () => {
  const widths = [
    { width: 390, height: 844 },
    { width: 1280, height: 900 },
  ];
  const groups = [
    { key: "public", title: "公開", note: "誰でも開ける画面。" },
    { key: "organizer", title: "主催者", note: "運営する側の画面。" },
  ];
  const entries = [
    { no: "01", group: "public", name: "ホーム", label: "", file: "mock-home.html", path: "/", note: "最初の画面。" },
    {
      no: "04",
      group: "public",
      name: "イベント告知・出欠",
      label: "満員",
      file: "mock-event-full.html",
      path: "/events/abc",
      note: "参加者が見る。",
    },
    {
      no: "16",
      group: "organizer",
      name: "主催一覧",
      label: "",
      file: "mock-organizer.html",
      path: "/organizer/events",
      note: "公開中と受付停止。",
    },
  ];
  const scopes = { "mock-home.html": "pop", "mock-organizer.html": "quiet" };
  const html = indexHtml(entries, {
    groups,
    widths,
    stylesheets: ["assets/aaa.css"],
    scopeOf: (file) => scopes[file] ?? "none",
  });

  it("区分ごとの見出しと件数を出す", () => {
    expect(html).toContain("公開");
    expect(html).toContain("2 画面");
    expect(html).toContain("主催者");
    expect(html).toContain("1 画面");
  });

  it("名前は枠で開き、幅は切り替えで足す", () => {
    expect(html).toContain('data-open-width="390"');
    expect(html).toContain('data-open-width="1280"');
    expect(html).toContain(
      'data-frame="mock-frame.html?p=mock-home.html"',
    );
    expect(html).toContain(
      'href="mock-frame.html?p=mock-home.html&amp;w=390"',
    );
  });

  it("行ごとにスマホ・PC・HTML のリンクを持つ", () => {
    expect(html).toContain('href="mock-frame.html?p=mock-organizer.html&amp;w=390"');
    expect(html).toContain('href="mock-frame.html?p=mock-organizer.html&amp;w=1280"');
    expect(html).toContain('href="mock-organizer.html"');
  });

  it("状態はバッジで出し、装飾のスコープを添える", () => {
    expect(html).toContain("満員");
    expect(html).toContain("scope-tag scope-tag--pop");
    expect(html).toContain("scope-tag scope-tag--quiet");
    expect(html).toContain('<link rel="stylesheet" href="assets/aaa.css">');
  });

  it("画面名の記号をそのまま HTML にしない", () => {
    const one = indexHtml(
      [{ ...entries[0], name: "<img src=x onerror=alert(1)>" }],
      { groups, widths },
    );
    expect(one).not.toContain("<img src=x");
    expect(one).toContain("&lt;img src=x");
  });

  it("装飾のスコープは生成した HTML のクラスから読む", () => {
    expect(scopeOfHtml('<div class="deco deco--tape deco--tape-shadow">')).toBe("pop");
    expect(scopeOfHtml('<div class="deco deco--tape deco--tape-quiet">')).toBe("quiet");
    expect(scopeOfHtml('<div class="page">')).toBe("none");
  });
});

describe("UI ソースの指紋", () => {
  function makeTree() {
    const root = mkdtempSync(path.join(tmpdir(), "mock-hash-"));
    const files = {
      "src/app/page.tsx": "export default () => null;\n",
      "src/app/globals.css": "body { margin: 0; }\n",
      "src/lib/format.ts": "export const yen = (n: number) => `${n}円`;\n",
      "src/lib/prisma.ts": "export const prisma = {};\n",
      "src/modules/events/components/Card.tsx": "export const Card = () => null;\n",
      "src/modules/events/lib/calc.ts": "export const calc = () => 1;\n",
    };
    for (const [name, body] of Object.entries(files)) {
      mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
      writeFileSync(path.join(root, name), body);
    }
    return root;
  }

  it("画面に関わるファイルだけを対象にする", () => {
    const files = uiSourceFiles(makeTree());
    expect(files).toContain("src/app/page.tsx");
    expect(files).toContain("src/app/globals.css");
    expect(files).toContain("src/lib/format.ts");
    expect(files).toContain("src/modules/events/components/Card.tsx");
    expect(files).not.toContain("src/lib/prisma.ts");
    expect(files).not.toContain("src/modules/events/lib/calc.ts");
  });

  it("同じ内容なら同じ指紋、1 ファイル変えれば変わる", () => {
    const root = makeTree();
    const first = computeUiHash(root);
    expect(computeUiHash(root)).toBe(first);

    writeFileSync(path.join(root, "src/app/page.tsx"), "export default () => null; // 変更\n");
    expect(computeUiHash(root)).not.toBe(first);
  });

  it("対象外のファイルを変えても指紋は動かない", () => {
    const root = makeTree();
    const first = computeUiHash(root);
    writeFileSync(path.join(root, "src/modules/events/lib/calc.ts"), "export const calc = () => 2;\n");
    expect(computeUiHash(root)).toBe(first);
  });

  it("改行が CRLF でも LF でも同じ指紋になる", () => {
    const root = makeTree();
    const first = computeUiHash(root);
    writeFileSync(path.join(root, "src/app/page.tsx"), "export default () => null;\r\n");
    expect(computeUiHash(root)).toBe(first);
  });

  it("改行を落とすのは CRLF だけで、他のバイトは変えない", () => {
    expect(normalizeNewlines(Buffer.from("a\r\nb\rc\nd"))).toEqual(Buffer.from("a\nb\rc\nd"));
    const plain = Buffer.from("a\nb");
    expect(normalizeNewlines(plain)).toBe(plain);
  });
});

describe("画面の目録", () => {
  const screens = placeholderScreens();

  it("No と slug の組が重複しない", () => {
    const keys = screens.map((row) => `${row.no}/${row.slug}/${row.stateKey}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("出力するファイル名が重複しない", () => {
    const files = expectedFiles();
    expect(new Set(files).size).toBe(files.length);
  });

  it("代表の状態だけが接尾辞なしのファイル名になる", () => {
    expect(expectedFiles()).toContain("mock-event.html");
    expect(expectedFiles()).toContain("mock-event-member.html");
    expect(expectedFiles()).toContain("mock-participant-history.html");
    expect(expectedFiles()).toContain("mock-participant-history-empty.html");
    expect(expectedFiles()).not.toContain("mock-participant-history-default.html");
  });

  it("すべての画面に page.tsx が実在する", () => {
    const missing = screens
      .map((row) => pageFileFor(pathFor(row, 1280)))
      .filter((file) => !existsSync(path.join(ROOT, file)));
    expect([...new Set(missing)]).toEqual([]);
  });

  it("テーマを 1 つ足すと、モックは 1 枚増える", () => {
    const themeRows = screens.filter((row) => row.theme !== undefined);
    // テーマ未選択 1 枚 + 全テーマ 1 枚ずつ。
    expect(themeRows).toHaveLength(SEMANTIC_THEME_IDS.length + 1);
    // テーマ以外の状態は 33 枚。画面そのものを足したときだけ、この数を直す。
    expect(expectedFiles()).toHaveLength(33 + themeRows.length);
  });

  it("テーマの状態は、製品のすべてのテーマと未選択を 1 枚ずつ持つ", () => {
    const rows = screens.filter((row) => row.slug === "organizer-public" && row.theme !== undefined);
    // undefined（DB のまま）は含めない。null は「テーマ未選択」。
    const themes = rows.map((row) => row.theme).filter((theme) => theme !== null);
    expect(new Set(themes)).toEqual(new Set(SEMANTIC_THEME_IDS));
    expect(rows.filter((row) => row.theme === null)).toHaveLength(1);
    // 表示名は製品のラベルと同じにする（モックの一覧でテーマ名が食い違わないように）。
    for (const row of rows) {
      if (row.theme === null) continue;
      expect(row.label).toBe(SEMANTIC_THEMES.find((theme) => theme.id === row.theme)?.label);
    }
  });

  it("--only は 0 詰めでも、詰めなくても、ファイル名でも絞れる", () => {
    const rows = placeholderScreens();
    expect(selectRows(rows, ["1"]).map((row) => row.no)).toEqual(["01"]);
    expect(selectRows(rows, ["01"]).map((row) => row.no)).toEqual(["01"]);
    expect(selectRows(rows, ["20-create"]).map((row) => row.file)).toEqual(["mock-create.html"]);
    expect(selectRows(rows, ["99"])).toHaveLength(0);
    expect(selectRows(rows, null)).toBe(rows);
  });
});

describe("端末の幅で見る枠", () => {
  const widths = [
    { width: 390, height: 844 },
    { width: 1280, height: 900 },
  ];
  const groups = [
    { key: "public", title: "公開" },
    { key: "organizer", title: "主催者" },
  ];
  const entries = [
    { no: "01", group: "public", name: "ホーム", label: "", file: "mock-home.html", path: "/" },
    {
      no: "04",
      group: "public",
      name: "イベントページ",
      label: "ログイン済み",
      file: "mock-event-member.html",
      path: "/events/abc",
    },
    { no: "21", group: "organizer", name: "イベントを作る", label: "", file: "mock-create.html", path: "/organizer/events/new" },
  ];

  it("URL は画面と幅を持つ（ファイル名はエスケープする）", () => {
    expect(frameUrl("mock-home.html", 390)).toBe("mock-frame.html?p=mock-home.html&w=390");
    expect(frameUrl("a b.html", 1280)).toBe("mock-frame.html?p=a%20b.html&w=1280");
  });

  it("枠の中で読み込む URL は帯を出さない（embed=1）", () => {
    expect(frameSrc("mock-home.html")).toBe("mock-home.html?embed=1");
    expect(frameSrc("mock-home.html?v=1")).toBe("mock-home.html?v=1&embed=1");
    const html = frameHtml(entries, { widths, groups });
    expect(html).toContain('"mock-home.html": "mock-home.html?embed=1"');
  });

  it("iframe と幅の切り替えを持ち、画面はすべて選択肢に入る", () => {
    const html = frameHtml(entries, { widths, groups });
    expect(html).toContain('<iframe id="frame"');
    expect(html).toContain('data-width="390"');
    expect(html).toContain('data-width="1280"');
    expect(html).toContain('{"390":844,"1280":900}');
    for (const entry of entries) expect(html).toContain(`<option value="${entry.file}">`);
  });

  it("状態は名前の後ろに括弧で出す", () => {
    const html = frameHtml(entries, { widths, groups });
    expect(html).toContain("04 イベントページ（ログイン済み）");
    expect(html).toContain('<optgroup label="公開">');
    expect(html).toContain('<optgroup label="主催者">');
  });

  it("画面名にタグが入っていても、そのまま HTML にならない", () => {
    const html = frameHtml(
      [{ ...entries[0], name: "<img src=x onerror=alert(1)>" }],
      { widths, groups },
    );
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;img src=x");
  });

  it("一覧と枠が欠けていれば止める", () => {
    const files = ["mock-home.html"];
    const tools = Object.fromEntries(
      TOOL_FILES.filter((name) => name !== "mock-frame.html").map((name) => [name, sha256(name)]),
    );
    const problems = evaluateSync({
      manifest: { uiHash: "ui-1", screens: [{ file: "mock-home.html", hash: sha256("mock-home.html") }] },
      expected: files,
      uiHash: "ui-1",
      fileHashes: new Map([
        ["mock-home.html", sha256("mock-home.html")],
        ...Object.entries(tools),
      ]),
      tools: TOOL_FILES,
      extraFiles: [...files, ...TOOL_FILES],
    });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("mock-frame.html");
  });
});

describe("同期の判定", () => {
  const files = ["mock-home.html", "mock-service.html"];
  const hashes = new Map(files.map((file) => [file, sha256(file)]));
  const manifest = {
    uiHash: "ui-1",
    screens: files.map((file) => ({ file, hash: sha256(file) })),
  };

  const judge = (overrides = {}) =>
    evaluateSync({
      manifest,
      expected: files,
      uiHash: "ui-1",
      fileHashes: hashes,
      extraFiles: files,
      ...overrides,
    });

  it("manifest が無ければ、mock:sync の実行を案内する", () => {
    const problems = judge({ manifest: null });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("mock:sync");
  });

  it("UI ソースの指紋が違えば止める", () => {
    expect(judge({ uiHash: "ui-2" })).toEqual([
      expect.stringContaining("mock:sync"),
    ]);
  });

  it("ソースも HTML も一致していれば通す", () => {
    expect(judge()).toEqual([]);
  });

  it("目録にある HTML が欠けていれば止める", () => {
    const problems = judge({
      fileHashes: new Map([["mock-home.html", sha256("mock-home.html")]]),
    });
    expect(problems.some((problem) => problem.includes("mock-service.html"))).toBe(true);
  });

  it("HTML を手で直すと止める", () => {
    const problems = judge({
      fileHashes: new Map([["mock-home.html", "x"], ["mock-service.html", sha256("mock-service.html")]]),
    });
    expect(problems.some((problem) => problem.includes("手で編集"))).toBe(true);
  });

  it("目録に無い HTML が残っていれば止める", () => {
    const problems = judge({ extraFiles: [...files, "mock-old.html"] });
    expect(problems.some((problem) => problem.includes("mock-old.html"))).toBe(true);
  });
});

describe("404 の写しを残さない", () => {
  const url = "http://localhost:3014/organizers/abc";

  it("題名が Next.js の 404 なら止める", () => {
    expect(captureProblem({ title: "404: This page could not be found.", url })).toEqual({
      kind: "title",
      detail: "404: This page could not be found.",
    });
  });

  it("題名が製品の「見つかりません」なら止める", () => {
    expect(captureProblem({ title: "主催者が見つかりません", url })?.kind).toBe("title");
    expect(captureProblem({ title: "イベントが見つかりません", url })?.kind).toBe("title");
  });

  it("同じ出所の 4xx / 5xx なら止める", () => {
    expect(
      captureProblem({
        httpErrors: ["404 http://localhost:3014/api/v1/public/organizers/abc"],
        title: "佐藤 みのり",
        url,
      }),
    ).toEqual({ kind: "http", detail: "404 http://localhost:3014/api/v1/public/organizers/abc" });
  });

  it("別のホストの失敗は数えない", () => {
    expect(
      captureProblem({ httpErrors: ["404 https://cdn.example.com/a.png"], title: "秋の芋煮会", url }),
    ).toBeNull();
  });

  it("題名も応答も正常なら通す", () => {
    expect(
      captureProblem({ httpErrors: [], title: "秋の芋煮会", url }),
    ).toBeNull();
  });

  it("撮れなかったときは、デモデータの作り直しを案内する", () => {
    const message = captureProblemMessage({
      kind: "title",
      detail: "主催者が見つかりません",
    });
    expect(message).toContain("主催者が見つかりません");
    expect(message).toContain("db:seed:ui");
  });
});

describe("リンクを URL の型で解決する", () => {
  const demo = { events: { main: "ev-main", full: "ev-full" }, organizerId: "org-1" };
  const rows = [
    { path: "/organizer/events/ev-main/edit", file: "mock-edit.html" },
    { path: "/organizer/events/ev-main/participants", file: "mock-roster.html" },
    { path: "/organizer/events/ev-full/participants", file: "mock-roster.html" },
    { path: "/events/ev-main", file: "mock-event.html" },
    { path: "/events/ev-main/receipt", file: "mock-event-receipt.html" },
    { path: "/events/ev-main?invite=ev-main", file: "mock-event.html" },
  ];

  it("デモ ID を * にした型も対応表に入る", () => {
    const targets = buildLinkTargets(rows, demo);
    expect(targets.get("/organizer/events/*/edit")).toBe("mock-edit.html");
    expect(targets.get("/organizer/events/*/participants")).toBe("mock-roster.html");
    expect(targets.get("/events/*")).toBe("mock-event.html");
    expect(targets.get("/events/*/receipt")).toBe("mock-event-receipt.html");
  });

  it("デモデータが無ければ、完全一致の対応表のまま", () => {
    const targets = buildLinkTargets(rows);
    expect(targets.get("/organizer/events/*/edit")).toBeUndefined();
    expect(targets.get("/events/ev-main")).toBe("mock-event.html");
  });

  it("撮るたびに変わる ID でも、型が合えばモックへ向く", () => {
    const targets = buildLinkTargets(rows, demo);
    const html = [
      '<a href="/organizer/events/2026-abc/edit">編集</a>',
      '<a href="/organizer/events/2026-abc/participants">参加者を見る</a>',
      '<a href="/events/2026-abc">公開ページ</a>',
      '<a href="/events/2026-abc/receipt">領収書</a>',
      '<a href="/events/2026-abc/unknown">未知</a>',
    ].join("\n");
    const out = rewriteInternalLinks(html, targets);

    expect(out).toContain('<a href="mock-edit.html">編集</a>');
    expect(out).toContain('<a href="mock-roster.html">参加者を見る</a>');
    expect(out).toContain('<a href="mock-event.html">公開ページ</a>');
    expect(out).toContain('<a href="mock-event-receipt.html">領収書</a>');
    expect(out).toContain('<a href="#">未知</a>');
  });

  it("完全一致を型より先に採り、型どうしは * が少ないほうを採る", () => {
    const targets = new Map([
      ["/a/b", "exact.html"],
      ["/*/*", "loose.html"],
      ["/a/*", "tight.html"],
    ]);
    expect(matchLinkTarget("/a/b", targets)).toBe("exact.html");
    expect(matchLinkTarget("/x/b", targets)).toBe("loose.html");
    expect(matchLinkTarget("/a/c", targets)).toBe("tight.html");
    expect(matchLinkTarget("/a/c/d", targets)).toBe(null);
  });

  it("* は 1 セグメントだけに当たる（末尾の / は同じに見る）", () => {
    const targets = new Map([["/organizer/events/*/edit", "mock-edit.html"]]);
    expect(matchLinkTarget("/organizer/events/x/edit", targets)).toBe("mock-edit.html");
    expect(matchLinkTarget("/organizer/events/x/y/edit", targets)).toBe(null);
    expect(matchLinkTarget("/organizer/events/x/edit/", targets)).toBe("mock-edit.html");
  });
});

describe("モック専用の操作の script", () => {
  const html =
    '<!doctype html>\n<html lang="ja"><head><meta charset="utf-8"></head><body><main>本文</main></body></html>';

  it("帯の script の直後に置く（defer なので順に動く）", () => {
    const shelled = withMockShell(html, { file: "mock-home.html", name: "01 ホーム" });
    const out = withMockInteractions(shelled);
    expect(out).toContain('<script src="mock-interactions.js" defer></script>');
    expect(out.indexOf("mock-shell.js")).toBeLessThan(out.indexOf("mock-interactions.js"));
    expect(out.indexOf("mock-interactions.js")).toBeLessThan(out.indexOf("</body>"));
  });

  it("帯が無い HTML では body の閉じタグの直前に置く", () => {
    const out = withMockInteractions(html);
    expect(out).toContain('<script src="mock-interactions.js" defer></script>');
    expect(out.indexOf("mock-interactions.js")).toBeLessThan(out.indexOf("</body>"));
  });

  it("二重には足さない", () => {
    const once = withMockInteractions(html);
    expect(withMockInteractions(once)).toBe(once);
  });

  it("操作の script が無い HTML を検出する", () => {
    const contents = new Map([
      ["mock-home.html", withMockInteractions(html)],
      ["mock-service.html", html],
    ]);
    const problems = missingInteractions(["mock-home.html", "mock-service.html"], contents);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("mock-service.html");
    expect(problems[0]).toContain("mock:sync");
  });
});

describe("音声入力の写し", () => {
  // 製品の音声入力（覆い・既定でオンの任意項目・郵便番号の住所補完）を写した印。
  const complete =
    'const scrim = "voice-scrim";' +
    '<input type="checkbox" data-voice-optional checked>' +
    "event-postal-code event-prefecture event-city event-town";

  it("覆い・任意の項目・郵便番号の補完がそろっていれば通す", () => {
    expect(missingVoiceSimulation(complete)).toEqual([]);
  });

  it("覆いが無ければ止める", () => {
    const problems = missingVoiceSimulation(complete.replace("voice-scrim", "scrim"));
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("voice-scrim");
  });

  it("「任意の項目も聞く」が既定でチェックされていなければ止める", () => {
    const problems = missingVoiceSimulation(complete.replace(" checked>", ">"));
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("任意の項目も聞く");
  });

  it("郵便番号から住所を埋める写しが無ければ止める", () => {
    const problems = missingVoiceSimulation(complete.replace("event-town", "town"));
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("郵便番号");
  });

  it("ファイルが空なら止める", () => {
    expect(missingVoiceSimulation("")).toHaveLength(1);
  });

  it("実際の mock-interactions.js は 3 つとも持っている", () => {
    const source = readFileSync(path.join(ROOT, "style-guide", "mock-interactions.js"), "utf8");
    expect(missingVoiceSimulation(source)).toEqual([]);
  });
});

describe("隠し DOM の合成", () => {
  it("閉じているステップの本文を、見出しの直後へ隠して差し込む", () => {
    const html =
      '<ol class="event-steps">' +
      '<li class="event-step" data-mock-step-key="basic"><h2 class="event-step__heading"><button class="event-step__toggle" aria-controls="event-step-basic">基本</button></h2></li>' +
      "</ol>";
    const out = mergeStepBodies(html, {
      basic: '<div id="event-step-basic" class="event-step__body">本文</div>',
    });

    expect(out).toContain('data-mock-step-body="basic"');
    expect(out).toContain('data-mock-hidden="true"');
    expect(out.indexOf("id=\"event-step-basic\"")).toBeGreaterThan(out.indexOf("</h2>"));
    expect(out.indexOf("</h2>")).toBeLessThan(out.indexOf("id=\"event-step-basic\""));
  });

  it("すでに本文があるステップは二重にしない", () => {
    const html =
      '<li class="event-step" data-mock-step-key="pricing" data-mock-step-body="pricing">' +
      '<h2></h2><div id="event-step-pricing">本文</div></li>';
    const out = mergeStepBodies(html, { pricing: '<div id="event-step-pricing">写し</div>' });
    expect(out.match(/id="event-step-pricing"/g)).toHaveLength(1);
    expect(out).toBe(html);
  });

  it("目印の無いステップは触らない", () => {
    const html = '<li class="event-step"><h2></h2></li>';
    expect(mergeStepBodies(html, { basic: "<div id=\"event-step-basic\">本文</div>" })).toBe(html);
  });

  it("選んでいない日の一覧を、いまの日の次へ隠して並べる", () => {
    const html =
      '<div class="cal"></div>' +
      '<section class="section" data-mock-cal-section="true" data-mock-cal-date="2026-10-28">' +
      "<h2>10月28日</h2></section>";
    const out = mergeCalendarDays(html, {
      "2026-10-29": '<section class="section"><h2>10月29日</h2></section>',
      "2026-10-28": '<section class="section"><h2>写し</h2></section>',
    });

    expect(out).not.toContain("data-mock-cal-section");
    expect(out).toContain('data-mock-cal-date="2026-10-28"');
    expect(out).toContain('data-mock-cal-date="2026-10-29"');
    expect(out).toContain('data-mock-hidden="true"');
    expect(out.match(/data-mock-cal-date="2026-10-28"/g)).toHaveLength(1);
    // 隠す日は、いまの日の後ろに置く。
    expect(out.indexOf("10月28日")).toBeLessThan(out.indexOf("10月29日"));
  });

  it("日別セクションの目印が無ければ何もしない", () => {
    const html = '<div class="cal"></div>';
    expect(mergeCalendarDays(html, { "2026-10-29": "<section></section>" })).toBe(html);
  });

  it("集めてきた断片に残る目印は落としてから付け直す", () => {
    const html =
      '<section class="section" data-mock-cal-section="true" data-mock-cal-date="2026-10-28">' +
      "<h2>10月28日</h2></section>";
    const out = mergeCalendarDays(html, {
      "2026-10-29":
        '<section class="section" data-mock-cal-section="true" data-mock-cal-date="2026-10-28">' +
        "<h2>10月29日</h2></section>",
    });

    expect(out.match(/data-mock-cal-date="2026-10-29"/g)).toHaveLength(1);
    expect(out.match(/data-mock-cal-date="2026-10-28"/g)).toHaveLength(1);
    expect(out).not.toContain("data-mock-cal-section");
  });

  it("本文に残る目印も重ねない", () => {
    const html = '<li class="event-step" data-mock-step-key="basic"><h2></h2></li>';
    const out = mergeStepBodies(html, {
      basic: '<div data-mock-step-body="basic" id="event-step-basic">本文</div>',
    });
    expect(out.match(/data-mock-step-body="basic"/g)).toHaveLength(1);
    expect(out.match(/data-mock-hidden="true"/g)).toHaveLength(1);
  });

  it("集めるべき断片があるかを、目印から判断する", () => {
    expect(variantsWanted('<li data-mock-step-key="basic"></li>')).toEqual({
      steps: true,
      days: false,
      wanted: true,
    });
    expect(
      variantsWanted(
        '<li data-mock-step-key="basic"></li><div id="event-step-basic" data-mock-step-body="basic"></div>',
      ),
    ).toEqual({ steps: false, days: false, wanted: false });
    expect(
      variantsWanted('<i data-mock-date="2026-10-28"></i><section data-mock-cal-section="true"></section>'),
    ).toEqual({ steps: false, days: true, wanted: true });
  });

  it("ステップとカレンダーを 1 回で合成する", () => {
    const html =
      '<li class="event-step" data-mock-step-key="basic"><h2></h2></li>' +
      '<section class="section" data-mock-cal-section="true" data-mock-cal-date="2026-10-28"></section>';
    const out = mergeVariants(html, {
      steps: { basic: '<div id="event-step-basic">本文</div>' },
      calendarDays: { "2026-10-29": "<section></section>" },
    });
    expect(out).toContain("event-step-basic");
    expect(out).toContain('data-mock-cal-date="2026-10-29"');
  });
});

describe("断片の控え", () => {
  it("同じ HTML なら同じ指紋、1 文字変えれば変わる", () => {
    expect(sourceHashOf("<div></div>")).toBe(sourceHashOf("<div></div>"));
    expect(sourceHashOf("<div></div>")).not.toBe(sourceHashOf("<div> </div>"));
  });

  it("書いた控えを、同じ指紋のときだけ読む", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "mock-variants-"));
    const file = path.join(dir, "mock-create.json");
    const hash = sourceHashOf("clean");

    await writeVariantCache(file, {
      sourceHash: hash,
      path: "/organizer/events/new",
      uiHash: "ui-1",
      steps: { basic: "<div>本文</div>" },
      calendarDays: {},
    });

    const hit = await readVariantCache(file, hash);
    expect(hit.steps.basic).toBe("<div>本文</div>");
    expect(await readVariantCache(file, "other")).toBe(null);
  });

  it("壊れた控えは捨てて、生成を止めない", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "mock-variants-"));
    const file = path.join(dir, "mock-broken.json");
    writeFileSync(file, "{ これは JSON ではない");
    expect(await readVariantCache(file, "x")).toBe(null);
    expect(await readVariantCache(path.join(dir, "missing.json"), "x")).toBe(null);
  });

  it("変化が無く PNG がそろっているときだけ撮影を省く", () => {
    expect(shouldReuseShots({ changed: false, shotsExist: true })).toBe(true);
    expect(shouldReuseShots({ changed: true, shotsExist: true })).toBe(false);
    expect(shouldReuseShots({ changed: false, shotsExist: false })).toBe(false);
    expect(shouldReuseShots({ changed: false, shotsExist: true, refresh: true })).toBe(false);
  });
});
