// 製品の画面を開いて、モック（style-guide/mock-*.html）を丸ごと差し替える。
//
//   npm run mock:sync                  # 全画面。本番ビルドを配って撮る（既定）
//   npm run mock:sync -- --only=20,24  # No. で絞る（画面 1 枚 5 秒前後）
//   npm run mock:sync -- --no-shots    # HTML だけ（PNG を撮らない）
//   npm run mock:sync -- --refresh     # 控え（断片・CSS・PNG）を使わずに取り直す
//   npm run mock:sync -- --dev         # 開発サーバーで撮る（保存がそのまま出る）
//
// 前提: `npm run db:seed:ui` でデモデータを作ってあること（storage/ui-demo.json）。
//
// 比較はしない。製品の DOM をそのまま写し、CSS と画像を style-guide/assets/ に
// 落として、リンクだけモック同士の行き来に付け替える。判定は scripts/check-mock-sync.mjs
// がソースのハッシュで行う（ブラウザを使わない）。
//
// 撮り直しの時間を短くするため、3 つをローカルに控える（`storage/` 配下、コミットしない）。
//   断片 … 閉じているステップの本文と、選んでいない日の一覧（storage/mock-variants/）
//   CSS  … 撮るたびに同じ CSS を取り直さない（storage/mock-assets.json）
//   PNG  … 変化の無い画面の 390 / 1280 を撮らない（storage/mock-shots/）

import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
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
  withMockInteractions,
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
  fragmentsOf,
  mergeVariants,
  readVariantCache,
  shouldReuseShots,
  sourceHashOf,
  variantsWanted,
  writeVariantCache,
} from "./lib/mock-variants.mjs";
import {
  applySemanticTheme,
  clearEventLock,
  collectVariants,
  editEventId,
  fetchResource,
  isSameOrigin,
  markVariants,
  missingDemoRecords,
  openCapturePage,
  readHtml,
  reissueEmailChangeTokens,
  reissueVerifyUserSession,
  settle,
} from "./lib/capture-core.mjs";
import { captureProblem, captureProblemMessage } from "./lib/mock-found.mjs";
import { ensureHarness, prewarm, sleep } from "./lib/ui-harness.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const STYLE_DIR = path.join(ROOT, "style-guide");
const ASSETS_DIR = path.join(STYLE_DIR, "assets");
const SHOTS_DIR = path.join(ROOT, "storage", "mock-shots");
const VARIANTS_DIR = path.join(ROOT, "storage", "mock-variants");
const ASSET_CACHE = path.join(ROOT, "storage", "mock-assets.json");
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
const refresh = args.includes("--refresh");
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

/**
 * 前回の CSS の控え。UI ソースの指紋が同じときだけ使う。
 *
 * CSS は 33 画面すべてが同じファイルを指すので、画面ごとに取り直すと 33 往復になる。
 * 指紋が変われば全部捨てる（`--refresh` でも捨てる）。
 */
async function readStylesheetCache(uiHash) {
  try {
    const data = JSON.parse(await readFile(ASSET_CACHE, "utf8"));
    if (data.uiHash !== uiHash || typeof data.stylesheets !== "object") return new Map();
    const usable = [];
    for (const [href, name] of Object.entries(data.stylesheets)) {
      if (typeof name !== "string") continue;
      try {
        await stat(path.join(ASSETS_DIR, name));
        usable.push([href, name]);
      } catch {
        // 片付いた素材は使わない（取り直す）。
      }
    }
    return new Map(usable);
  } catch {
    return new Map();
  }
}

/** 断片の控えの置き場所。1 画面 1 ファイル。 */
function variantCachePath(row) {
  return path.join(VARIANTS_DIR, row.file.replace(/\.html$/, ".json"));
}

/** PNG が 2 枚そろっているか。そろっていなければ撮り直す。 */
async function shotsExist(stem) {
  for (const size of WIDTHS) {
    try {
      await stat(path.join(SHOTS_DIR, `${stem}-${size.width}.png`));
    } catch {
      return false;
    }
  }
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

  // 撮る前に、デモデータの ID が DB に残っているかを見る。ずれていると
  // 存在しない主催者・催しの 404 を写し、気づかないままモックに残る（PR #90）。
  const missing = await missingDemoRecords(demo);
  if (missing.length > 0) {
    const shown = missing.slice(0, 3).join(" / ");
    const rest = missing.length > 3 ? ` ほか ${missing.length - 3} 件` : "";
    throw new Error(
      `storage/ui-demo.json の ID が DB にありません（${shown}${rest}）。\n` +
        "`npm run db:seed:ui` でデモデータを作り直してから、撮り直してください。",
    );
  }

  const full = rows.length === allRows.length;
  const previous = await readJson(MANIFEST);
  const linkTargets = buildLinkTargets(allRows, demo);
  // 控えの有効性は UI ソースの指紋で決める。最後にも同じ値を manifest へ書く。
  const uiHashNow = computeUiHash(ROOT);
  uiHashNowForRun = uiHashNow;
  const stylesheetCache = refresh ? new Map() : await readStylesheetCache(uiHashNow);

  await mkdir(ASSETS_DIR, { recursive: true });
  await mkdir(SHOTS_DIR, { recursive: true });
  await mkdir(VARIANTS_DIR, { recursive: true });

  // この画面は開くとトークンを消費する。撮る前に同じ値で発行し直す。
  if (rows.some((row) => row.slug === "account-verify")) {
    const reissued = await reissueEmailChangeTokens(demo);
    if (!reissued) {
      log("メールアドレス変更のトークンを発行し直せませんでした（db:seed:ui をやり直してください）");
    }
    // 変更は他の端末のセッションを失効させる。同じ会員のセッションも撮る前に
    // 発行し直さないと、2 回目からヘッダーだけ未ログインの絵になる。
    const session = await reissueVerifyUserSession(demo);
    if (session) {
      demo.tokens.verifyUser = session;
    } else {
      log("確認用の会員のセッションを発行し直せませんでした（.env の JWT_SECRET を確認してください）");
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
            const captured = await captureRow(page, row, linkTargets, stylesheetCache);
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
  const uiHash = full ? uiHashNow : (previous?.uiHash ?? null);
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

  // CSS の控え。次回は同じ指紋のあいだ、この対応表から引く。
  await writeJson(ASSET_CACHE, {
    uiHash: uiHashNow,
    stylesheets: Object.fromEntries(stylesheetCache),
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
  const shots = noShots ? "" : ` / PNG ${shotsWritten} 枚（変化の無い画面は省略）`;
  log(
    `\n${ordered.length} 画面を同期しました（HTML 更新 ${updated + wrote + framed} / ${seconds}s${shots}）。` +
      (refresh ? "\n--refresh のため、控えを使わずに取り直しました。" : "") +
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
async function captureRow(page, row, linkTargets, stylesheetCache) {
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
  // 画面ごとに記録を空にする。同じタブを使い回すので、前の画面の応答を
  // そのまま持ち越すと、どの画面の異常か分からなくなる。
  page.resetErrors();
  await page.waitForReady(url);

  // 404 の写しを残さない。デモデータと DB がずれていると、この画面は
  // 「見つかりません」になる（PR #90 で 12 画面がそうなっていた）。
  const problem = captureProblem({
    httpErrors: page.takeErrors().httpErrors,
    title: await page.evaluate("document.title"),
    url,
  });
  if (problem) throw new Error(captureProblemMessage(problem));

  await page.evaluate("window.scrollTo(0, 0)");

  // 目録がテーマを指定していれば、サーバーが出した属性を差し替える。テーマは属性
  // だけで決まるので、そのテーマを保存している主催者と同じ DOM になる。
  if (row.theme !== undefined) {
    const applied = await applySemanticTheme(page, row.theme);
    if (applied === null) {
      log(`注意 ${row.no} ${row.file}  テーマの適用範囲（.semantic-theme--page）がありません`);
    }
  }

  // 目印を付けてから HTML を読む。付けるのは属性だけなので見た目は変わらない。
  await markVariants(page);
  const raw = await readHtml(page);

  const clean = sanitizeHtml(raw);
  const wanted = variantsWanted(clean);
  const sourceHash = sourceHashOf(clean);
  const cacheFile = variantCachePath(row);
  const cache = wanted.wanted && !refresh ? await readVariantCache(cacheFile, sourceHash) : null;

  const file = path.join(STYLE_DIR, row.file);
  const current = await readFile(file, "utf8").catch(() => null);
  const stem = shotStem(row);

  // 控えがあれば先に合成して、HTML に差が出るかを見る。差が無く PNG がそろっていれば
  // 撮らない（撮影がいちばん重い）。断片を集めるのは、この判定より後。
  let built = await buildHtml(page, clean, row, linkTargets, fragmentsOf(cache), stylesheetCache);
  let htmlChanged = current !== built.content;

  let skipShots = noShots;
  if (!noShots) {
    skipShots = shouldReuseShots({
      changed: htmlChanged,
      refresh,
      shotsExist: await shotsExist(stem),
    });
  }

  if (!skipShots) {
    const wideShot = await page.captureScreenshot();
    await page.setViewport(NARROW.width, NARROW.height);
    await settle(page);
    const narrowShot = await page.captureScreenshot();
    await writeFile(path.join(SHOTS_DIR, `${stem}-${WIDE.width}.png`), wideShot.data);
    await writeFile(path.join(SHOTS_DIR, `${stem}-${NARROW.width}.png`), narrowShot.data);
    shotsWritten += WIDTHS.length;
  }

  // 控えが無ければ、製品の画面を押して隠し DOM を集める。押した状態は
  // 収集の最後に戻すが、撮影は必ずこの前に済ませる。
  if (wanted.wanted && !cache) {
    await page.setViewport(WIDE.width, WIDE.height);
    await settle(page);
    const collected = await collectVariants(page);
    await writeVariantCache(cacheFile, {
      sourceHash,
      path: pathFor(row, WIDE.width),
      uiHash: uiHashNowForRun,
      steps: collected.steps,
      calendarDays: collected.calendarDays,
    });
    built = await buildHtml(page, clean, row, linkTargets, collected, stylesheetCache);
  }

  htmlChanged = await writeIfChanged(file, built.content);

  // 次の行のために、ロックを返してから離れる。
  if (eventId) {
    await page.navigate("about:blank");
    await sleep(200);
    await clearEventLock(eventId);
  }

  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  log(
    `${htmlChanged ? "更新" : "同じ"} ${row.no} ${row.file}${row.label ? `（${row.label}）` : ""} ${seconds}s` +
      (built.assets.failed > 0 ? `  素材 ${built.assets.failed} 件は元の URL のまま` : ""),
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
      hash: createHash("sha256").update(normalizeNewlines(Buffer.from(built.content))).digest("hex"),
    },
  };
}

// 撮っている最中の URL。`captureRow` の中だけで使う。
let webUrl = "";

/** この実行の UI ソースの指紋。断片の控えに残す。 */
let uiHashNowForRun = "";

/** 実行中に取った素材。同じ画像を画面ごとに取り直さない。 */
const runAssets = new Map();

/** 実際に書いた PNG の枚数。省略した画面があるとログの数字が変わる。 */
let shotsWritten = 0;

/** 製品の HTML を、単体で開けるモックに整える。 */
async function buildHtml(page, clean, row, linkTargets, fragments, stylesheetCache) {
  const assets = { written: 0, failed: 0 };

  const stylesheets = new Map();
  for (const href of stylesheetHrefs(clean)) {
    if (!isSameOrigin(href, webUrl)) continue;
    const cached = stylesheetCache.get(href);
    const saved = cached ?? (await saveAsset(page, href, assets));
    if (saved) stylesheets.set(href, saved);
  }
  // 使った CSS を控えへ戻す。次回はここから引く。
  for (const [href, name] of stylesheets) stylesheetCache.set(href, name);

  const images = new Map();
  for (const url of imageSources(clean)) {
    if (!isSameOrigin(url, webUrl)) continue;
    const saved = await saveAsset(page, url, assets);
    if (saved) images.set(url, saved);
  }

  let html = applyAssetMap(clean, { stylesheets, images });
  // 隠し DOM は、素材とリンクの差し替えより前に合成する。合成した本文にも
  // 画像・リンクが入っているので、同じ規則で通す必要がある。
  html = mergeVariants(html, fragments);
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
  // 操作の script は帯の直後。どちらも defer なので、この順で動く。
  html = withMockInteractions(html);
  return { content: `${html}\n`, assets };
}

/** 帯に出す画面名。状態つきは括弧で添える（例: 04 イベント告知・出欠（満員））。 */
function labelOf(row) {
  return row.label ? `${row.no} ${row.name}（${row.label}）` : `${row.no} ${row.name}`;
}

async function saveAsset(page, url, assets) {
  const memo = runAssets.get(url);
  if (memo) return memo;

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
  const saved = `assets/${name}`;
  runAssets.set(url, saved);
  return saved;
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
