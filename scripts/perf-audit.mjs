// 画面の初期表示を、本番ビルドに対して測る。
//
//   npm run perf:audit                     # storage/perf/before.json
//   npm run perf:audit -- --label=after    # storage/perf/after.json
//   npm run perf:audit -- --label=check --widths=390 --repeat=1
//
// 目的は「体感の遅さ」を数字に残すこと。全 44 画面ではなく代表 8 画面を、
// 390px と 1280px の 2 幅で開き、TTFB・FCP・LCP・CLS・リクエスト数・転送量と、
// `/api/v1/**` の 1 本ごとの所要時間を残す。結果は `storage/perf/<label>.json`
// （`storage/` は追跡しない）。同じ尺度で before / after を並べるための足場なので、
// 測り方（待ち方・幅・ログインの与え方）を変えるときは、before も撮り直すこと。
//
// 再利用するもの（依存は増やさない）:
//   scripts/lib/ui-browser.mjs    … headless の Edge / Chrome を CDP で動かす
//   scripts/lib/ui-harness.mjs    … 本番ビルド（`.next-ui-prod`）とブラウザの用意・片付け
//   scripts/lib/capture-core.mjs  … デモデータの ID が DB に残っているかの確認
//
// 本番ビルドは `next build` を `.next-ui-prod` へ出し、`next start` を空いている
// ポートで 1 本だけ起こす（`npm run mock:catchup` と同じやり方）。動いている開発
// サーバーの `.next` を壊さないため。src が変わっていれば最初に 1 度だけ作り直す。
//
// Cookie は `storage/ui-demo.json` のトークンを使う。期限が切れていたら、その会員の
// セッションを 1 本だけ延ばして署名し直す（行は増やさない）。デモデータそのものは
// 書き換えない。恒久的に直すときは `npm run db:seed:ui`。

import { spawnSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { PrismaClient } from "@prisma/client";
import { SignJWT } from "jose";

import { missingDemoRecords } from "./lib/capture-core.mjs";
import { openTarget, requireBrowser, sleep } from "./lib/ui-browser.mjs";
import { ensureBrowser, ensureProdServer, isListening, prewarm } from "./lib/ui-harness.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEMO_FILE = path.join(ROOT, "storage", "ui-demo.json");
const OUT_DIR = path.join(ROOT, "storage", "perf");

/** 本番サーバーを起こすポートの探索開始位置。開発（3012）と本番（3014）を避ける。 */
const PROD_PORT_START = 3110;

/** 端末幅ごとの高さ。390 / 1280 は `scripts/lib/mock-screens.mjs` の WIDTHS と同じ。 */
const WIDTH_HEIGHTS = { 390: 844, 1280: 900 };

/** 描画が落ち着いたあと、遅れて届く LCP / CLS を拾うための待ち。 */
const SETTLE_MS = 400;

/** デモのトークンを延ばす日数。`signLocalToken` と同じ 7 日。 */
const TOKEN_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

const args = process.argv.slice(2);

function valueOf(flag) {
  const found = args.find((arg) => arg.startsWith(`${flag}=`));
  return found ? found.slice(flag.length + 1) : null;
}

function log(message) {
  console.log(message);
}

const label = (valueOf("--label") ?? "before").trim();
if (!/^[A-Za-z0-9_-]+$/.test(label)) {
  console.error(`--label は英数と _ - だけで指定してください（${label}）。`);
  process.exit(1);
}

// LCP は 1 周ごとに ±15% 動く（画像の描画が数フレームずれるため）。1 周だけで
// before / after を並べると、直した効果とばらつきを読み違える。既定は 3 周の中央値。
const repeatArg = Number(valueOf("--repeat") ?? "3");
const repeat = Number.isFinite(repeatArg) && repeatArg > 0 ? Math.floor(repeatArg) : 3;

const widthArg = valueOf("--widths");
const widths = widthArg
  ? widthArg
      .split(",")
      .map((item) => Number(item.trim()))
      .filter((width) => Number.isFinite(width) && width > 0)
  : [390, 1280];
if (widths.length === 0) {
  console.error("--widths に測る幅を 1 つ以上指定してください（例: --widths=390,1280）。");
  process.exit(1);
}

const portArg = Number(valueOf("--port") ?? "0");

/**
 * 画面から読む観測器。ナビゲーションの前に仕込むので、描画の最初から拾える。
 *
 * LCP は「最後に届いた最大の要素」、CLS は「利用者の操作に寄らないずれ」の合計。
 * どちらも PerformanceObserver の buffered で、仕込む前のぶんも拾う。
 */
const OBSERVE_SCRIPT = String.raw`(() => {
  const state = { lcp: null, lcpElement: "", cls: 0, shifts: 0 };
  window.__perfAudit = state;

  const describe = (element) => {
    if (!element || !element.tagName) return "";
    const tag = element.tagName.toLowerCase();
    const className = typeof element.className === "string"
      ? element.className.split(/\s+/).filter(Boolean).slice(0, 2).join(".")
      : "";
    return className ? tag + "." + className : tag;
  };

  try {
    new PerformanceObserver((list) => {
      const entries = list.getEntries();
      const last = entries[entries.length - 1];
      if (!last) return;
      state.lcp = last.startTime;
      state.lcpElement = describe(last.element);
    }).observe({ type: "largest-contentful-paint", buffered: true });
  } catch {
    // LCP を知らないブラウザでは、その項目だけ空にする。
  }

  try {
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (entry.hadRecentInput) continue;
        state.cls += entry.value;
        state.shifts += 1;
      }
    }).observe({ type: "layout-shift", buffered: true });
  } catch {
    // CLS を知らないブラウザでは 0 のまま。
  }
})();`;

/** 描画が落ち着いたあとに読む。ナビゲーションと資源の生の値を返すだけ。 */
const READ_METRICS = String.raw`(() => {
  const nav = performance.getEntriesByType("navigation")[0] ?? null;
  const paint = {};
  for (const entry of performance.getEntriesByType("paint")) paint[entry.name] = entry.startTime;

  const resources = performance.getEntriesByType("resource").map((entry) => {
    let path = entry.name;
    try {
      const url = new URL(entry.name);
      path = url.pathname + url.search;
    } catch {
      // data: などは名前のまま残す（/api の判定に掛からない）。
    }
    return {
      path,
      initiator: entry.initiatorType,
      start: entry.startTime,
      duration: entry.duration,
      bytes: entry.transferSize || 0,
    };
  });

  const state = window.__perfAudit ?? {};

  return {
    url: location.href,
    title: document.title,
    nav: nav
      ? {
          ttfb: nav.responseStart,
          requestStart: nav.requestStart,
          responseEnd: nav.responseEnd,
          domContentLoaded: nav.domContentLoadedEventEnd,
          load: nav.loadEventEnd,
          transferSize: nav.transferSize || 0,
        }
      : null,
    fcp: paint["first-contentful-paint"] ?? null,
    lcp: state.lcp ?? null,
    lcpElement: state.lcpElement ?? "",
    cls: state.cls ?? 0,
    shifts: state.shifts ?? 0,
    resources,
  };
})();`;

/** 画面と、その画面を開く条件。デモデータの ID が無い画面は `path: null` で残す。 */
function buildPages(demo) {
  const events = demo.events ?? {};
  return [
    { key: "home", name: "ホーム", path: "/", auth: null },
    {
      key: "event",
      name: "イベント告知",
      path: events.main ? `/events/${events.main}` : null,
      needs: "events.main",
      auth: null,
    },
    {
      key: "organizer-public",
      name: "主催者のページ",
      path: demo.organizerId ? `/organizers/${demo.organizerId}` : null,
      needs: "organizerId",
      auth: null,
    },
    {
      key: "invitation",
      name: "招待の着地",
      path: demo.inviteCode ? `/invitations/${demo.inviteCode}` : null,
      needs: "inviteCode",
      auth: null,
    },
    { key: "organizer-events", name: "主催一覧", path: "/organizer/events", auth: "organizer" },
    {
      key: "roster",
      name: "参加者名簿",
      path: events.main ? `/organizer/events/${events.main}/participants` : null,
      needs: "events.main",
      auth: "organizer",
    },
    { key: "mypage", name: "主催者マイページ", path: "/mypage", auth: "organizer" },
    { key: "participant", name: "参加者ホーム", path: "/participant", auth: "participant" },
  ];
}

/** デモデータを読む。無ければ、作り方（db:seed:ui）を案内して止まる。 */
async function readDemo() {
  let text;
  try {
    text = await readFile(DEMO_FILE, "utf8");
  } catch {
    throw new Error(
      "storage/ui-demo.json がありません。先に `npm run db:seed:ui` を実行してください。",
    );
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error("storage/ui-demo.json を読めません。`npm run db:seed:ui` で作り直してください。");
  }
}

/** デモデータが指す行が DB に残っているか。ずれたまま撮ると 404 を測ってしまう。 */
async function assertDemoRecords(demo) {
  let missing;
  try {
    missing = await missingDemoRecords(demo);
  } catch (error) {
    throw new Error(
      `DB を読めません（${error instanceof Error ? error.message : error}）。.env の DATABASE_URL を確認してください。`,
    );
  }
  if (missing.length === 0) return;

  const shown = missing.slice(0, 3).join(" / ");
  const rest = missing.length > 3 ? ` ほか ${missing.length - 3} 件` : "";
  throw new Error(
    `storage/ui-demo.json の ID が DB にありません（${shown}${rest}）。\n` +
      "`npm run db:seed:ui` でデモデータを作り直してから、もう一度実行してください。",
  );
}

/** JWT の期限だけを見る（署名は検証しない。使う直前にアプリが確かめる）。 */
function isTokenFresh(token) {
  if (typeof token !== "string" || token.split(".").length !== 3) return false;
  try {
    const payload = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8"));
    return typeof payload.exp === "number" && payload.exp * 1000 > Date.now() + 60 * 60 * 1000;
  } catch {
    return false;
  }
}

/** デモのアカウント名から、DB の会員 ID を引く。 */
function userIdFor(demo, name) {
  if (name === "organizer") return demo.organizerId ?? null;
  if (name === "participant") return demo.participantId ?? null;
  return null;
}

/**
 * ログインに使うトークンを用意する。
 *
 * `storage/ui-demo.json` のトークンは `db:seed:ui` の 7 日で切れる。切れているのに
 * そのまま開くと、ログインの要る画面がすべてログインへ飛び、基準値が撮れない。
 * 期限切れのものだけ、その会員の既存セッションを延ばして署名し直す（行は増やさない）。
 * デモデータは書き換えない。
 */
async function resolveTokens(demo) {
  const tokens = { ...(demo.tokens ?? {}) };
  const needed = [...new Set(buildPages(demo).map((page) => page.auth).filter(Boolean))];
  const stale = needed.filter((name) => !isTokenFresh(tokens[name]));
  if (stale.length === 0) return tokens;

  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < 32) {
    log(
      "JWT_SECRET が無いため、期限の切れたトークンを発行し直せません。" +
        "ログインの要る画面は飛ばします（`npm run db:seed:ui` でデモデータを作り直してください）。",
    );
    return tokens;
  }

  const prisma = new PrismaClient();
  try {
    for (const name of stale) {
      const userId = userIdFor(demo, name);
      const user = userId
        ? await prisma.user.findUnique({
            where: { id: userId },
            select: { id: true, email: true },
          })
        : null;
      if (!user) {
        log(`デモの会員（${name}）が見つかりません。ログインの要る画面は飛ばします。`);
        delete tokens[name];
        continue;
      }

      const current = await prisma.authSession.findFirst({
        where: { userId: user.id, revokedAt: null },
        orderBy: { createdAt: "desc" },
      });
      const expiresAt = new Date(Date.now() + TOKEN_DAYS * DAY_MS);
      const session = current
        ? await prisma.authSession.update({ where: { id: current.id }, data: { expiresAt } })
        : await prisma.authSession.create({ data: { userId: user.id, expiresAt } });

      tokens[name] = await new SignJWT({ userId: user.id, email: user.email })
        .setProtectedHeader({ alg: "HS256" })
        .setSubject(user.id)
        .setJti(session.id)
        .setIssuedAt()
        .setExpirationTime(`${TOKEN_DAYS}d`)
        .sign(new TextEncoder().encode(secret));
    }
  } finally {
    await prisma.$disconnect();
  }

  log(
    `storage/ui-demo.json のトークンが期限切れのため、${stale.join(" / ")} を 1 本だけ発行し直しました` +
      "（デモデータは書き換えていません。恒久的に直すときは `npm run db:seed:ui`）。",
  );
  return tokens;
}

/** 記録する量。`samples` の中央値を `metrics` に載せる。 */
const METRIC_KEYS = [
  "ttfbMs",
  "fcpMs",
  "lcpMs",
  "cls",
  "domContentLoadedMs",
  "loadMs",
  "requestCount",
  "transferredBytes",
  "apiRequests",
  "apiTotalMs",
];

const COUNT_KEYS = new Set(["requestCount", "transferredBytes", "apiRequests"]);

function median(values) {
  const list = values
    .filter((value) => typeof value === "number" && Number.isFinite(value))
    .sort((left, right) => left - right);
  if (list.length === 0) return null;
  const middle = Math.floor(list.length / 2);
  if (list.length % 2 === 1) return list[middle];
  return Math.round(((list[middle - 1] + list[middle]) / 2) * 10) / 10;
}

function round1(value) {
  return typeof value === "number" && Number.isFinite(value) ? Math.round(value * 10) / 10 : null;
}

function round4(value) {
  return typeof value === "number" && Number.isFinite(value) ? Math.round(value * 10000) / 10000 : null;
}

/**
 * CDP の Network から、その画面のリクエスト数と転送量を数える。
 *
 * `PerformanceResourceTiming` は文書そのものを含まず、クロスオリジン（Google Fonts）の
 * 転送量も 0 になる。合計は `Network.loadingFinished` の `encodedDataLength` を使う。
 */
function watchNetwork(page) {
  const { cdp } = page;
  const rows = new Map();
  const mine = (sessionId) => sessionId === page.sessionId;

  const offs = [
    cdp.on("Network.requestWillBeSent", (params, sessionId) => {
      if (!mine(sessionId)) return;
      rows.set(params.requestId, {
        url: params.request.url,
        method: params.request.method,
        type: params.type,
        status: null,
        bytes: 0,
      });
    }),
    cdp.on("Network.responseReceived", (params, sessionId) => {
      if (!mine(sessionId)) return;
      const row = rows.get(params.requestId);
      if (row) row.status = params.response.status;
    }),
    cdp.on("Network.loadingFinished", (params, sessionId) => {
      if (!mine(sessionId)) return;
      const row = rows.get(params.requestId);
      if (row) row.bytes = params.encodedDataLength ?? 0;
    }),
  ];

  return {
    summary() {
      // data: や blob: は数えない（文書と HTTP の取得だけを見る）。
      const list = [...rows.values()].filter((row) => /^https?:/i.test(row.url));
      const document = list.find((row) => row.type === "Document");
      return {
        requestCount: list.length,
        transferredBytes: list.reduce((sum, row) => sum + row.bytes, 0),
        documentStatus: document?.status ?? null,
      };
    },
    dispose() {
      for (const off of offs) off();
    },
  };
}

/** 1 周ぶんの生の値を、比較できる形に整える。 */
function sampleOf(raw, network) {
  const api = raw.resources
    .filter((entry) => entry.path.startsWith("/api/v1/"))
    .map((entry) => ({
      path: entry.path,
      startMs: round1(entry.start),
      durationMs: round1(entry.duration),
      bytes: entry.bytes,
      initiator: entry.initiator,
    }))
    .sort((left, right) => left.startMs - right.startMs);

  return {
    url: raw.url,
    title: raw.title,
    ttfbMs: round1(raw.nav?.ttfb),
    fcpMs: round1(raw.fcp),
    lcpMs: round1(raw.lcp),
    lcpElement: raw.lcpElement ?? "",
    cls: round4(raw.cls),
    domContentLoadedMs: round1(raw.nav?.domContentLoaded),
    loadMs: round1(raw.nav?.load),
    requestCount: network.requestCount,
    transferredBytes: network.transferredBytes,
    apiRequests: api.length,
    apiTotalMs: round1(api.reduce((sum, row) => sum + row.durationMs, 0)),
    api,
  };
}

/**
 * 期待した画面に着いたか。ログインへ飛んだ・404 になった回は測らずに理由を返す。
 * 数だけ出して「速くなった」と読み違えないよう、飛ばした理由を JSON と表に残す。
 */
function skipReasonOf(def, raw, network) {
  const expected = def.path.split("?")[0];
  let finalPath = null;
  try {
    finalPath = new URL(raw.url).pathname;
  } catch {
    finalPath = null;
  }
  if (finalPath && finalPath !== expected) {
    if (finalPath.startsWith("/auth/")) {
      return `ログインできず ${finalPath} へ移動しました` +
        "（storage/ui-demo.json のトークンが失効しています。npm run db:seed:ui を実行してください）";
    }
    return `${finalPath} へ移動しました`;
  }
  if (network.documentStatus !== null && network.documentStatus >= 400) {
    return `文書の応答が ${network.documentStatus} でした`;
  }
  if (raw.title && raw.title.includes("見つかりません")) {
    return "画面が見つかりません（storage/ui-demo.json の ID が DB とずれています）";
  }
  return null;
}

/** 1 画面 × 1 幅を、`repeat` 回開いて中央値をまとめる。 */
async function measurePage({ browser, baseUrl, def, width, tokens }) {
  const base = { page: def.key, name: def.name, path: def.path, auth: def.auth, width };

  if (!def.path) {
    return { ...base, ok: false, skipped: `storage/ui-demo.json に ${def.needs} がありません` };
  }
  if (def.auth && !tokens[def.auth]) {
    return {
      ...base,
      ok: false,
      skipped:
        `ログイン用のトークンがありません（${def.auth}）。` +
        "`npm run db:seed:ui` でデモデータを作り直してから、もう一度実行してください",
    };
  }

  const url = `${baseUrl}${def.path}`;
  const samples = [];
  let skipped = null;

  for (let run = 0; run < repeat && !skipped; run += 1) {
    // 画面ごとに Cookie と HTTP キャッシュを分ける（初回表示を測るため）。
    const page = await openTarget(browser, {
      isolate: true,
      baseUrl,
      tokens,
      waitProfile: "fast",
    });
    try {
      await page.setViewport(width, WIDTH_HEIGHTS[width] ?? 900);
      await page.applyAuth(def.auth ?? null);
      await page.cdp.send("Performance.enable", {}, page.sessionId);
      await page.cdp.send(
        "Page.addScriptToEvaluateOnNewDocument",
        { source: OBSERVE_SCRIPT },
        page.sessionId,
      );

      const network = watchNetwork(page);
      try {
        await page.navigate(url);
        // 取得と描画が落ち着くまで待つ。長引いても、そこで読んで先へ進む。
        await page.waitForStable({ timeoutMs: 15000 });
        await sleep(SETTLE_MS);

        const raw = await page.evaluate(READ_METRICS);
        const summary = network.summary();
        skipped = skipReasonOf(def, raw, summary);
        if (skipped) break;

        const sample = sampleOf(raw, summary);
        // 画面の例外は合否にしないが、数字の裏取りのために残す。
        sample.consoleErrors = page.takeErrors().consoleErrors;
        samples.push(sample);
      } finally {
        network.dispose();
      }
    } finally {
      await page.close().catch(() => {});
    }
  }

  if (skipped) return { ...base, ok: false, skipped };
  if (samples.length === 0) return { ...base, ok: false, skipped: "計測できませんでした" };

  const metrics = {};
  for (const key of METRIC_KEYS) {
    const value = median(samples.map((sample) => sample[key]));
    metrics[key] = COUNT_KEYS.has(key) && value !== null ? Math.round(value) : value;
  }

  const last = samples[samples.length - 1];
  return {
    ...base,
    ok: true,
    skipped: null,
    runs: samples.length,
    title: last.title,
    lcpElement: last.lcpElement,
    metrics,
    // 1 本ごとの内訳は最後の周のもの。中央値は `metrics` 側に持つ。
    api: last.api,
    samples: samples.map(({ api, ...rest }) => rest),
  };
}

/** 空いているポートを 1 つ探す。既に誰かが立てているサーバーを測らないため。 */
async function freePort(start) {
  for (let port = start; port < start + 40; port += 1) {
    if (!(await isListening(port))) return port;
  }
  throw new Error(`${start} から 40 個のポートがすべて使用中です。--port= で指定してください。`);
}

/** 表示幅。日本語は 2 桁として数え、表の桁をそろえる。 */
function displayWidth(text) {
  let width = 0;
  for (const char of text) width += char.codePointAt(0) > 0x2000 ? 2 : 1;
  return width;
}

function padEnd(text, width) {
  return text + " ".repeat(Math.max(0, width - displayWidth(text)));
}

function padStart(text, width) {
  return " ".repeat(Math.max(0, width - displayWidth(text))) + text;
}

function ms(value) {
  return value === null || value === undefined ? "-" : String(Math.round(value));
}

function kb(bytes) {
  return bytes === null || bytes === undefined ? "-" : String(Math.round(bytes / 1024));
}

/** 人が読む表。JSON は細かいが、こちらは「どこが遅いか」を 1 画面で見るため。 */
function printTable(results) {
  const header = ["ページ", "幅", "TTFB", "FCP", "LCP", "CLS", "req", "転送KB", "API本", "API計"];
  const line = [
    padEnd(header[0], 24),
    padStart(header[1], 5),
    padStart(header[2], 6),
    padStart(header[3], 6),
    padStart(header[4], 6),
    padStart(header[5], 6),
    padStart(header[6], 5),
    padStart(header[7], 7),
    padStart(header[8], 6),
    padStart(header[9], 7),
  ].join(" ");
  log(line);
  log("-".repeat(displayWidth(line)));

  for (const result of results) {
    if (!result.ok) continue;
    const metrics = result.metrics;
    log(
      [
        padEnd(result.name, 24),
        padStart(String(result.width), 5),
        padStart(ms(metrics.ttfbMs), 6),
        padStart(ms(metrics.fcpMs), 6),
        padStart(ms(metrics.lcpMs), 6),
        padStart(metrics.cls === null ? "-" : metrics.cls.toFixed(3), 6),
        padStart(String(metrics.requestCount ?? "-"), 5),
        padStart(kb(metrics.transferredBytes), 7),
        padStart(String(metrics.apiRequests ?? "-"), 6),
        padStart(ms(metrics.apiTotalMs), 7),
      ].join(" "),
    );
  }
}

/** 遅い `/api/v1/**` を上から並べる。原因の当たりを付けるための補助。 */
function printSlowestApis(results, limit = 6) {
  const rows = [];
  for (const result of results) {
    if (!result.ok) continue;
    for (const call of result.api) {
      rows.push({ ...call, name: result.name, width: result.width });
    }
  }
  if (rows.length === 0) return;

  rows.sort((left, right) => right.durationMs - left.durationMs);
  log("\n遅い API（最後の周の所要時間）:");
  for (const row of rows.slice(0, limit)) {
    log(
      `  ${padStart(ms(row.durationMs), 6)} ms  ${padEnd(row.name, 20)} ${padStart(String(row.width), 5)}  ${row.path}`,
    );
  }
}

function printSkipped(results) {
  const skipped = results.filter((result) => !result.ok);
  if (skipped.length === 0) return;
  log(`\n測れなかった画面（${skipped.length}）:`);
  for (const result of skipped) {
    const where = result.path ? `${result.name} ${result.path} ${result.width}px` : result.name;
    log(`  ${padEnd(where, 44)} ${result.skipped}`);
  }
}

function gitValue(arguments_) {
  const result = spawnSync("git", arguments_, { cwd: ROOT, encoding: "utf8" });
  return result.status === 0 ? result.stdout.trim() : null;
}

async function main() {
  const started = Date.now();

  // ブラウザが無いままビルドを 2 分待たないよう、先に確かめる。
  requireBrowser();

  const demo = await readDemo();
  await assertDemoRecords(demo);
  const tokens = await resolveTokens(demo);
  const pages = buildPages(demo);

  const port = portArg > 0 ? portArg : await freePort(PROD_PORT_START);
  if (portArg > 0 && (await isListening(port))) {
    throw new Error(`ポート ${port} は使用中です。空いているポートを --port= で指定してください。`);
  }

  log(`本番ビルドを ${port} 番で起こします（.next-ui-prod / ${repeat} 周 / 幅 ${widths.join(", ")}）。`);

  let server = null;
  let browser = null;
  const results = [];

  try {
    server = await ensureProdServer({ port, log });
    browser = await ensureBrowser({ profilePrefix: "perf-audit" });

    // 1 本目だけ「初回のコンパイル待ち」が乗らないよう、測る前に一度ずつ開く。
    const targets = pages
      .filter((def) => def.path && (!def.auth || tokens[def.auth]))
      .map((def) => ({ url: `${server.url}${def.path}`, auth: def.auth }));
    await prewarm(targets, { tokens, concurrency: 2 });

    for (const def of pages) {
      for (const width of widths) {
        let result;
        try {
          result = await measurePage({ browser, baseUrl: server.url, def, width, tokens });
        } catch (error) {
          result = {
            page: def.key,
            name: def.name,
            path: def.path,
            auth: def.auth,
            width,
            ok: false,
            skipped: `計測に失敗しました（${error instanceof Error ? error.message : error}）`,
          };
        }
        results.push(result);
        if (result.ok) {
          log(`測りました ${def.name} ${width}px（LCP ${ms(result.metrics.lcpMs)} ms）`);
        } else {
          log(`飛ばしました ${def.name} ${width}px  ${result.skipped}`);
        }
      }
    }
  } finally {
    await browser?.close().catch(() => {});
    await server?.close().catch(() => {});
  }

  const payload = {
    version: 1,
    label,
    generatedAt: new Date().toISOString(),
    commit: gitValue(["rev-parse", "--short", "HEAD"]),
    branch: gitValue(["rev-parse", "--abbrev-ref", "HEAD"]),
    baseUrl: server?.url ?? null,
    widths,
    repeat,
    durationSeconds: Math.round((Date.now() - started) / 100) / 10,
    notes: {
      build: "next build（NEXT_DIST_DIR=.next-ui-prod）→ next start。src が変わっていれば最初に作り直す。",
      cache: "画面ごとに新しいブラウザコンテキストを開く（Cookie と HTTP キャッシュは空から）。",
      metrics: `1 画面 ${repeat} 周の中央値。api は最後の周の 1 本ごとの値。`,
      bytes: "CDP の encodedDataLength の合計（圧縮後・ヘッダー込み）。",
      api: "/api/v1/** の PerformanceResourceTiming。startMs はナビゲーション開始からの経過。",
    },
    pages: pages.map((def) => ({
      page: def.key,
      name: def.name,
      path: def.path,
      auth: def.auth,
    })),
    results,
  };

  await mkdir(OUT_DIR, { recursive: true });
  const outFile = path.join(OUT_DIR, `${label}.json`);
  await writeFile(outFile, `${JSON.stringify(payload, null, 2)}\n`, "utf8");

  log("");
  printTable(results);
  printSlowestApis(results);
  printSkipped(results);

  const measured = results.filter((result) => result.ok).length;
  log(
    `\n${measured} / ${results.length} 件を測りました（${payload.durationSeconds}s）。\n` +
      `保存: ${path.relative(ROOT, outFile)}（storage/ は追跡しません）`,
  );
}

await main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
