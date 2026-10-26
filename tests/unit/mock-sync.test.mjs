// モックの生成と同期の仕様。scripts/lib/mock-html.mjs / mock-hash.mjs / mock-screens.mjs /
// check-mock-sync.mjs を直接読み込む。ブラウザも DB も使わない。

import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { evaluateSync, sha256, TOOL_FILES } from "../../scripts/check-mock-sync.mjs";
import { frameHtml, frameUrl } from "../../scripts/lib/mock-frame.mjs";
import {
  applyAssetMap,
  assetName,
  imageSources,
  parseSrcset,
  rewriteInternalLinks,
  sanitizeHtml,
  stylesheetHrefs,
  withNotice,
} from "../../scripts/lib/mock-html.mjs";
import { computeUiHash, normalizeNewlines, uiSourceFiles } from "../../scripts/lib/mock-hash.mjs";
import {
  expectedFiles,
  pageFileFor,
  pathFor,
  placeholderScreens,
  selectRows,
} from "../../scripts/lib/mock-screens.mjs";

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

  it("注意書きは doctype の直後に入る", () => {
    const html = withNotice("<!doctype html><html lang=\"ja\"></html>", {
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

  it("33 の状態を持つ", () => {
    expect(expectedFiles()).toHaveLength(33);
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
    const problems = evaluateSync({
      manifest: { uiHash: "ui-1", screens: [{ file: "mock-home.html", hash: sha256("mock-home.html") }] },
      expected: files,
      uiHash: "ui-1",
      fileHashes: new Map([
        ["mock-home.html", sha256("mock-home.html")],
        ["mock-index.html", sha256("index")],
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
