// 製品の画面を開いて、モック（style-guide/mock-*.html）を丸ごと差し替える。
//
//   npm run mock:sync                  # 全画面。本番ビルドを配って撮る（既定）
//   npm run mock:sync -- --only=20,24  # No. で絞る（画面 1 枚 5 秒前後）
//   npm run mock:sync -- --no-shots    # HTML だけ（PNG を撮らない）
//   npm run mock:sync -- --dev         # 開発サーバーで撮る（保存がそのまま出る）
//
// 前提: `npm run db:seed:ui` でデモデータを作ってあること（storage/ui-demo.json）。
//
// 比較はしない。製品の DOM をそのまま写し、CSS と画像を style-guide/assets/ に
// 落として、リンクだけモック同士の行き来に付け替える。判定は scripts/check-mock-sync.mjs
// がソースのハッシュで行う（ブラウザを使わない）。

import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  assetName,
  applyAssetMap,
  extensionFor,
  imageSources,
  rewriteInternalLinks,
  sanitizeHtml,
  stylesheetHrefs,
  withMockShell,
  withNotice,
} from "./lib/mock-html.mjs";
import { computeUiHash, normalizeNewlines } from "./lib/mock-hash.mjs";
import { indexHtml, scopeOfHtml } from "./lib/mock-index.mjs";
import { escapeHtml, frameHtml, frameUrl } from "./lib/mock-frame.mjs";
import {
  buildScreens,
  expandScreens,
  linkTargets as buildLinkTargets,
  MOCK_GROUPS,
  pathFor,
  selectRows,
  WIDTHS,
} from "./lib/mock-screens.mjs";
import {
  clearEventLock,
  editEventId,
  fetchResource,
  isSameOrigin,
  openCapturePage,
  readHtml,
  reissueEmailChangeTokens,
  settle,
} from "./lib/capture-core.mjs";
import { ensureHarness, prewarm, sleep } from "./lib/ui-harness.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const STYLE_DIR = path.join(ROOT, "style-guide");
const ASSETS_DIR = path.join(STYLE_DIR, "assets");
const SHOTS_DIR = path.join(ROOT, "storage", "mock-shots");
const MANIFEST = path.join(STYLE_DIR, "mock-manifest.json");
const DEMO_FILE = path.join(ROOT, "storage", "ui-demo.json");
const WIDE = WIDTHS[WIDTHS.length - 1];
const NARROW = WIDTHS[0];

const args = process.argv.slice(2);
const only = valueOf("--only")
  ?.split(",")
  .map((item) => item.trim())
  .filter(Boolean);
const noShots = args.includes("--no-shots");
const useDev = args.includes("--dev");
const concurrencyArg = valueOf("--concurrency");
const concurrency =
  concurrencyArg && Number.isFinite(Number(concurrencyArg)) ? Math.max(1, Number(concurrencyArg)) : 4;

function valueOf(flag) {
  const found = args.find((arg) => arg.startsWith(`${flag}=`));
  return found ? found.slice(flag.length + 1) : null;
}

function log(message) {
  console.log(message);
}

/** JSON を、末尾の改行まで同じ形で書く。 */
async function writeJson(file, value) {
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

/** 中身が同じなら触らない。触ると mtime が動き、git も差分として拾う。 */
async function writeIfChanged(file, content) {
  try {
    const current = await readFile(file, "utf8");
    if (current === content) return false;
  } catch {
    // 無ければ書く。
  }
  await writeFile(file, content, "utf8");
  return true;
}

async function main() {
  const started = Date.now();

  let demo;
  try {
    demo = JSON.parse(await readFile(DEMO_FILE, "utf8"));
  } catch {
    throw new Error(
      `storage/ui-demo.json が読めません。先に \`npm run db:seed:ui\` を実行してください。`,
    );
  }

  const screens = buildScreens(demo);
  const allRows = expandScreens(screens);
  const rows = selectRows(allRows, only);
  if (rows.length === 0) throw new Error("対象の画面がありません。--only の指定を確認してください。");

  const full = rows.length === allRows.length;
  const previous = await readJson(MANIFEST);
  const linkTargets = buildLinkTargets(allRows);

  await mkdir(ASSETS_DIR, { recursive: true });
  await mkdir(SHOTS_DIR, { recursive: true });

  // この画面は開くとトークンを消費する。撮る前に同じ値で発行し直す。
  if (rows.some((row) => row.slug === "account-verify")) {
    const reissued = await reissueEmailChangeTokens(demo);
    if (!reissued) {
      log("メールアドレス変更のトークンを発行し直せませんでした（db:seed:ui をやり直してください）");
    }
  }

  const harness = await ensureHarness({
    mode: useDev ? "dev" : "prod",
    needs: { web: true, mock: false, browser: true },
    profilePrefix: "mock-sync",
    log,
  });
  webUrl = harness.webUrl;

  const failures = [];
  const results = new Map();
  let updated = 0;

  try {
    if (useDev) {
      // 開発サーバーは初回アクセスでコンパイルする。撮る前に温めておく。
      await prewarm(
        rows.map((row) => ({ url: `${harness.webUrl}${pathFor(row, WIDE.width)}`, auth: row.auth })),
        { tokens: demo.tokens, concurrency },
      );
    }

    const parallel = rows.filter((row) => !row.serial);
    const serial = rows.filter((row) => row.serial);

    const worker = async (queue) => {
      const page = await openCapturePage(harness.browser, {
        webUrl: harness.webUrl,
        tokens: demo.tokens,
      });
      try {
        for (;;) {
          const row = queue.shift();
          if (!row) break;
          try {
            const captured = await captureRow(page, row, linkTargets);
            results.set(row.file, captured.entry);
            if (captured.changed) updated += 1;
          } catch (error) {
            failures.push({ row, error: error instanceof Error ? error.message : String(error) });
            log(`NG ${row.no} ${row.file}  ${error instanceof Error ? error.message : error}`);
          }
        }
      } finally {
        await page.close();
      }
    };

    const runners = [];
    const parallelSlots = serial.length > 0 ? Math.max(1, concurrency - 1) : Math.max(1, concurrency);
    for (let index = 0; index < Math.min(parallelSlots, parallel.length); index += 1) {
      runners.push(worker(parallel));
    }
    if (serial.length > 0) runners.push(worker(serial));
    await Promise.all(runners);
  } finally {
    await harness.close();
  }

  if (failures.length > 0) {
    log(`\n${failures.length} 画面を撮れませんでした。manifest は前回のままにします。`);
    process.exit(1);
  }

  // 部分同期では uiHash を進めない。進めると「撮っていない画面」まで
  // 同期済みに見えてしまう。コミット前は全体を回す。
  const uiHash = full ? computeUiHash(ROOT) : (previous?.uiHash ?? null);
  const entries = new Map((previous?.screens ?? []).map((entry) => [entry.file, entry]));
  for (const [file, entry] of results) entries.set(file, entry);

  const ordered = allRows
    .map((row) => entries.get(row.file))
    .filter(Boolean)
    .map((entry) => entry);

  await writeJson(MANIFEST, {
    version: 1,
    generatedBy: "npm run mock:sync",
    widths: WIDTHS.map((size) => size.width),
    uiHash,
    screens: ordered,
  });

  const wrote = await writeIndex(ordered);
  const framed = await writeFrame(ordered);
  await writeShotIndex(
    ordered.filter((entry) => results.has(entry.file)),
    noShots,
  );

  if (full) {
    await removeUnusedMocks(new Set(allRows.map((row) => row.file)));
    await removeUnusedAssets();
    if (!noShots) {
      const keep = new Set(
        allRows.flatMap((row) => WIDTHS.map((size) => `${shotStem(row)}-${size.width}.png`)),
      );
      await removeUnusedShots(keep);
    }
  }

  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  const shots = noShots ? "" : ` / PNG ${results.size * WIDTHS.length} 枚`;
  log(
    `\n${ordered.length} 画面を同期しました（HTML 更新 ${updated + wrote + framed} / ${seconds}s${shots}）。` +
      (full ? "" : "\n部分同期です。コミット前に `npm run mock:sync`（全体）を実行してください。"),
  );
  log(`一覧: ${path.relative(ROOT, path.join(STYLE_DIR, "mock-index.html"))}`);
  log(`枠:   ${frameUrl("mock-home.html", WIDE.width)}（--only では開きたい画面を p に指定）`);
}

async function readJson(file) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch {
    return null;
  }
}

/** 撮影のファイル名の語幹。目録の行にも manifest の項目にも同じ形で使える。 */
function shotStem(entry) {
  return `${entry.no}-${entry.file.replace(/^mock-/, "").replace(/\.html$/, "")}`;
}

/** 1 画面 × 1 状態を開き、HTML と PNG を書き出す。 */
async function captureRow(page, row, linkTargets) {
  const started = Date.now();
  const url = `${webUrl}${pathFor(row, WIDE.width)}`;
  const eventId = editEventId(url);

  // 編集画面は開いた時点でロックを取る。前回の残りを消してから開く。
  // 先に空のページへ移るのは、表示中の幅を変えた瞬間に生きている画面が
  // ロックを取り直し、消した直後に届くため。
  if (eventId) {
    await page.navigate("about:blank");
    await sleep(300);
    await clearEventLock(eventId);
  }

  await page.setViewport(WIDE.width, WIDE.height);
  await page.applyAuth(row.auth);
  await page.waitForReady(url);

  const raw = await readHtml(page);
  const wideShot = await page.captureScreenshot();
  let narrowShot = null;
  if (!noShots) {
    await page.setViewport(NARROW.width, NARROW.height);
    await settle(page);
    narrowShot = await page.captureScreenshot();
  }

  const html = await buildHtml(page, raw, row, linkTargets);
  const file = path.join(STYLE_DIR, row.file);
  const htmlChanged = await writeIfChanged(file, html.content);

  if (!noShots) {
    const stem = shotStem(row);
    await writeFile(path.join(SHOTS_DIR, `${stem}-${WIDE.width}.png`), wideShot.data);
    await writeFile(path.join(SHOTS_DIR, `${stem}-${NARROW.width}.png`), narrowShot.data);
  }

  // 次の行のために、ロックを返してから離れる。
  if (eventId) {
    await page.navigate("about:blank");
    await sleep(200);
    await clearEventLock(eventId);
  }

  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  log(
    `${htmlChanged ? "更新" : "同じ"} ${row.no} ${row.file}${row.label ? `（${row.label}）` : ""} ${seconds}s` +
      (html.assets.failed > 0 ? `  素材 ${html.assets.failed} 件は元の URL のまま` : ""),
  );

  return {
    changed: htmlChanged,
    entry: {
      no: row.no,
      group: row.group,
      slug: row.slug,
      name: row.name,
      note: row.note,
      state: row.stateKey,
      label: row.label,
      file: row.file,
      path: pathFor(row, WIDE.width),
      hash: createHash("sha256").update(normalizeNewlines(Buffer.from(html.content))).digest("hex"),
    },
  };
}

// 撮っている最中の URL。`captureRow` の中だけで使う。
let webUrl = "";

/** 製品の HTML を、単体で開けるモックに整える。 */
async function buildHtml(page, raw, row, linkTargets) {
  const clean = sanitizeHtml(raw);
  const assets = { written: 0, failed: 0 };

  const stylesheets = new Map();
  for (const href of stylesheetHrefs(clean)) {
    if (!isSameOrigin(href, webUrl)) continue;
    const saved = await saveAsset(page, href, assets);
    if (saved) stylesheets.set(href, saved);
  }

  const images = new Map();
  for (const url of imageSources(clean)) {
    if (!isSameOrigin(url, webUrl)) continue;
    const saved = await saveAsset(page, url, assets);
    if (saved) images.set(url, saved);
  }

  let html = applyAssetMap(clean, { stylesheets, images });
  html = rewriteInternalLinks(html, linkTargets);
  html = withNotice(html, { name: row.name, path: pathFor(row, WIDE.width) });
  // 帯は製品に無い。sanitizeHtml のあとで足す（先に足すと script が落とされる）。
  html = withMockShell(html, {
    file: row.file,
    name: labelOf(row),
    path: pathFor(row, WIDE.width),
    frame390: frameUrl(row.file, WIDTHS[0].width),
    frame1280: frameUrl(row.file, WIDE.width),
  });
  return { content: `${html}\n`, assets };
}

/** 帯に出す画面名。状態つきは括弧で添える（例: 04 イベント告知・出欠（満員））。 */
function labelOf(row) {
  return row.label ? `${row.no} ${row.name}（${row.label}）` : `${row.no} ${row.name}`;
}

async function saveAsset(page, url, assets) {
  const response = await fetchResource(page, url);
  if (!response.ok) {
    assets.failed += 1;
    return null;
  }
  const extension = extensionFor(response.type);
  const name = assetName(response.buffer, extension);
  const file = path.join(ASSETS_DIR, name);
  try {
    await readFile(file);
  } catch {
    await writeFile(file, response.buffer);
    assets.written += 1;
  }
  return `assets/${name}`;
}

/** 一覧ページ。モック同士の行き来だけを載せる（画像はローカルの PNG 側）。 */
async function writeIndex(entries) {
  const stylesheets = await productStylesheets(entries);
  const scopes = new Map();
  for (const entry of entries) {
    const html = await readFile(path.join(STYLE_DIR, entry.file), "utf8").catch(() => "");
    scopes.set(entry.file, scopeOfHtml(html));
  }

  const html = indexHtml(entries, {
    groups: MOCK_GROUPS,
    widths: WIDTHS,
    stylesheets,
    scopeOf: (file) => scopes.get(file) ?? "none",
  });

  return (await writeIfChanged(path.join(STYLE_DIR, "mock-index.html"), html)) ? 1 : 0;
}

/**
 * 一覧が読み込む製品の CSS。生成済みの画面から拾う。
 *
 * 一覧は製品の画面ではないが、見出しやボタンは製品と同じ見た目にしたい。
 * 撮った画面がすでに `assets/<hash>.css` を指しているので、その href を使い回す。
 */
async function productStylesheets(entries) {
  for (const entry of entries) {
    const html = await readFile(path.join(STYLE_DIR, entry.file), "utf8").catch(() => null);
    if (!html) continue;
    const hrefs = stylesheetHrefs(html).filter((href) => href.startsWith("assets/"));
    if (hrefs.length > 0) return hrefs;
  }
  return [];
}

/** 端末の幅で見る枠ページ。`mock-index.html` と同じく生成物。 */
async function writeFrame(entries) {
  const html = frameHtml(entries, { widths: WIDTHS, groups: MOCK_GROUPS });
  return (await writeIfChanged(path.join(STYLE_DIR, "mock-frame.html"), html)) ? 1 : 0;
}

/** ローカルの PNG 一覧。git には入れない。 */
async function writeShotIndex(entries, skip) {
  if (skip) return;
  const sections = entries
    .map((entry) => {
      const stem = shotStem(entry);
      const shots = WIDTHS.map(
        (size) =>
          `      <figure><img src="${stem}-${size.width}.png" alt="${escapeHtml(entry.name)} ${size.width}px"><figcaption>${size.width}px</figcaption></figure>`,
      ).join("\n");
      return `  <section>\n    <h2>${entry.no} ${escapeHtml(entry.name)}${entry.label ? `（${escapeHtml(entry.label)}）` : ""}</h2>\n    <div class="shots">\n${shots}\n    </div>\n  </section>`;
    })
    .join("\n");

  const html = `<!doctype html>
<html lang="ja">
<head>
  <meta charset="utf-8">
  <title>モックの撮影</title>
  <style>
    body { margin: 0 auto; max-width: 90rem; padding: 2rem 1.25rem 4rem; font-family: system-ui, sans-serif; color: #1c1917; background: #faf9f7; }
    h1 { font-size: 1.25rem; }
    h2 { font-size: .95rem; margin: 2rem 0 .5rem; }
    .shots { display: flex; gap: 1rem; align-items: flex-start; overflow-x: auto; }
    figure { margin: 0; }
    img { display: block; border: 1px solid #e7e5e4; background: #fff; max-height: 70vh; width: auto; }
    figcaption { color: #78716c; font-size: .75rem; margin-top: .25rem; }
  </style>
</head>
<body>
  <h1>モックの撮影（ローカルのみ）</h1>
${sections}
</body>
</html>
`;
  await writeIfChanged(path.join(SHOTS_DIR, "index.html"), html);
}

/** 目録から消えた画面の HTML を片付ける。一覧と枠は目録の外にある生成物なので残す。 */
async function removeUnusedMocks(keep) {
  const names = await readdir(STYLE_DIR).catch(() => []);
  for (const name of names) {
    if (!/^mock-.*\.html$/.test(name)) continue;
    if (name === "mock-index.html" || name === "mock-frame.html") continue;
    if (keep.has(name)) continue;
    await rm(path.join(STYLE_DIR, name), { force: true });
  }
}

/** どこからも参照されなくなった素材を片付ける。 */
async function removeUnusedAssets() {
  const referenced = new Set();
  const names = await readdir(STYLE_DIR).catch(() => []);
  for (const name of names) {
    if (!/^mock-.*\.html$/.test(name)) continue;
    const html = await readFile(path.join(STYLE_DIR, name), "utf8").catch(() => "");
    for (const match of html.matchAll(/assets\/([A-Za-z0-9._-]+)/g)) referenced.add(match[1]);
  }
  const assets = await readdir(ASSETS_DIR).catch(() => []);
  for (const name of assets) {
    if (referenced.has(name)) continue;
    await rm(path.join(ASSETS_DIR, name), { force: true });
  }
}

/** 目録から消えた画面の PNG を片付ける（ローカルのみなので、失敗しても構わない）。 */
async function removeUnusedShots(keep) {
  const names = await readdir(SHOTS_DIR).catch(() => []);
  for (const name of names) {
    if (!name.endsWith(".png")) continue;
    if (keep.has(name)) continue;
    await rm(path.join(SHOTS_DIR, name), { force: true });
  }
}

await main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
