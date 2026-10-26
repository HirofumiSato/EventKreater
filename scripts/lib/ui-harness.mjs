// モックの生成に要るもの（製品サーバーとブラウザ）を、必要な分だけ起こす。
//
//   scripts/mock-sync.mjs  … 1 回だけ使って片付ける（--only でも同じ）
//
// これまでは人が別々に起動していた。起動していないと落ちるので、
// 「1 周する」たびにターミナルを用意する手間がかかっていた。
// ここで面倒を見れば、コマンド 1 つで同じ状態まで行ける。
//
// 既に動いているものは壊さない。ポートが応答すれば再利用し、自分で立てたものだけ片付ける。
// `npm run dev` を別ターミナルで動かしている人の邪魔をしないため。

import { spawn } from "node:child_process";
import { mkdirSync, openSync } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { connectBrowser, sleep, waitForJson, DEFAULT_DEBUG_PORT } from "./ui-browser.mjs";
import { httpGet } from "./ui-http.mjs";
import { startMockServer } from "../mock-serve.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const CACHE_DIR = path.join(ROOT, "node_modules", ".cache", "ui-harness");

export const DEFAULT_WEB_PORT = 3012;
export const DEFAULT_MOCK_PORT = 4321;
/** 本番ビルドを配るポート。開発サーバー（3012）と同時に動かせるよう別にする。 */
export const DEFAULT_PROD_PORT = 3014;
/** 本番ビルドの出力先。開発サーバーの .next と混ぜない。 */
export const PROD_DIST_DIR = ".next-ui-prod";

/** ポートが受け付けているか。繋がれば true。 */
export function isListening(port, host = "127.0.0.1") {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host }, () => {
      socket.end();
      resolve(true);
    });
    socket.on("error", () => resolve(false));
    socket.setTimeout(1500, () => {
      socket.destroy();
      resolve(false);
    });
  });
}

async function responds(url, timeoutMs = 2000) {
  try {
    const response = await httpGet(url, { timeoutMs });
    return response.status < 500;
  } catch {
    return false;
  }
}

/** モック配信。応答すれば再利用し、無ければ自分で立てる。 */
export async function ensureMockServer({ port = DEFAULT_MOCK_PORT } = {}) {
  const base = `http://127.0.0.1:${port}`;
  if (await responds(`${base}/style-guide/mock-index.html`)) {
    return { url: base, owned: false, close: async () => {} };
  }
  const server = await startMockServer({ port });
  return { url: server.url, owned: true, close: server.close };
}

/**
 * 応答が返るまで待つ。再コンパイル中は 2〜3 秒返らないことがあるので、
 * 1 回の失敗で「無い」と決めない。
 */
async function waitForResponse(base, timeoutMs) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await responds(base, 3000)) return true;
    await sleep(1000);
  }
  return false;
}

/** 製品の dev サーバー。応答すれば再利用し、無ければ `next dev` を起こす。 */
export async function ensureWebServer({ port = DEFAULT_WEB_PORT, timeoutMs = 180000 } = {}) {
  const base = `http://127.0.0.1:${port}`;
  if (await responds(base, 3000)) {
    return { url: base, owned: false, close: async () => {} };
  }
  // 応答が遅いだけで、ポートは誰かが使っていることがある（大きな変更の直後や
  // 再コンパイル中）。この場合は起こさない。二重起動は EADDRINUSE で即死し、
  // その死を「起動に失敗した」と読み違えるため。
  if (await isListening(port)) {
    if (await waitForResponse(base, timeoutMs)) {
      return { url: base, owned: false, close: async () => {} };
    }
    throw new Error(`ポート ${port} は使用中ですが応答しません。使っているプロセスを止めてください。`);
  }

  mkdirSync(CACHE_DIR, { recursive: true });
  const logFile = path.join(CACHE_DIR, "next-dev.log");
  const log = openSync(logFile, "w");
  const child = spawn(process.execPath, [nextBin(), "dev", "-p", String(port), "--turbo"], {
    cwd: ROOT,
    stdio: ["ignore", log, log],
    env: process.env,
  });
  // 常駐するので、handle でイベントループを止めない（止めるときは stopChild）。
  child.unref();

  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await responds(base, 3000)) {
      return { url: base, owned: true, close: () => stopChild(child) };
    }
    if (child.exitCode !== null) {
      // 起動が競合した（自分より先に誰かが立てた）なら、そちらを使う。
      if (await waitForResponse(base, 5000)) {
        return { url: base, owned: false, close: async () => {} };
      }
      throw new Error(`next dev が終了しました（${child.exitCode}）。${path.relative(ROOT, logFile)} を見てください。`);
    }
    await sleep(1000);
  }
  stopChild(child);
  throw new Error(
    `next dev が ${Math.round(timeoutMs / 1000)} 秒以内に応答しませんでした。${path.relative(ROOT, logFile)} を見てください。`,
  );
}

function nextBin() {
  return fileURLToPath(import.meta.resolve("next/dist/bin/next"));
}

/** ビルドの鮮度を判定する入力。src と設定だけを見る（public は実行時に読まれる）。 */
const SOURCE_ENTRIES = [
  "src",
  "prisma/schema.prisma",
  "next.config.mjs",
  "package.json",
  "postcss.config.mjs",
  "postcss.config.js",
  "tailwind.config.ts",
  "tailwind.config.js",
  "tsconfig.json",
];

/**
 * ビルドが要るか。判定は mtime だけの粗いもの。
 *
 * BUILD_ID が無ければ要る。原稿（src と設定）のどれかが BUILD_ID より新しければ要る。
 * 触っていないファイルの mtime は変わらないので、変更が無い日の `--all` は
 * ビルドをやり直さない。
 */
export function needsBuild({ buildIdMtime, newestSourceMtime }) {
  if (buildIdMtime === null || buildIdMtime === undefined) return true;
  if (newestSourceMtime === null || newestSourceMtime === undefined) return false;
  return newestSourceMtime > buildIdMtime;
}

/** 指定した場所のうち、いちばん新しい mtime（ミリ秒）。無ければ null。 */
export async function newestMtime(root, entries = SOURCE_ENTRIES) {
  let newest = null;
  const visit = async (target) => {
    let info;
    try {
      info = await stat(target);
    } catch {
      return;
    }
    if (info.isDirectory()) {
      let names = [];
      try {
        names = await readdir(target);
      } catch {
        return;
      }
      await Promise.all(
        names
          .filter((name) => name !== "node_modules" && !name.startsWith(".next"))
          .map((name) => visit(path.join(target, name))),
      );
      return;
    }
    if (newest === null || info.mtimeMs > newest) newest = info.mtimeMs;
  };
  await Promise.all(entries.map((entry) => visit(path.join(root, entry))));
  return newest;
}

async function mtimeOf(file) {
  try {
    return (await stat(file)).mtimeMs;
  } catch {
    return null;
  }
}

/** ビルドを 1 回走らせ、終了を待つ。ログは node_modules/.cache/ui-harness/ に残す。 */
function runBuild({ timeoutMs, env }) {
  mkdirSync(CACHE_DIR, { recursive: true });
  const logFile = path.join(CACHE_DIR, "next-build.log");
  const log = openSync(logFile, "w");
  const child = spawn(process.execPath, [nextBin(), "build", "--no-lint"], {
    cwd: ROOT,
    stdio: ["ignore", log, log],
    env,
  });
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      stopChild(child);
      resolve({ ok: false, logFile, reason: "timeout" });
    }, timeoutMs);
    timer.unref?.();
    child.on("exit", (code) => {
      clearTimeout(timer);
      resolve({ ok: code === 0, logFile, reason: `exit ${code}` });
    });
    child.on("error", () => {
      clearTimeout(timer);
      resolve({ ok: false, logFile, reason: "spawn" });
    });
  });
}

/**
 * 製品の本番サーバー。開発サーバーより 1 リクエストあたりが 1 桁速い。
 *
 * モックの生成（`npm run mock:sync`）は全画面を開くので、こちらが効く。
 * ビルドは `.next-ui-prod` へ出し、動いている開発サーバーの `.next` を壊さない。
 * src が変わっていれば、その回の最初に 1 度だけビルドし直す。
 */
export async function ensureProdServer({
  port = DEFAULT_PROD_PORT,
  timeoutMs = 180000,
  buildTimeoutMs = 300000,
  log = () => {},
} = {}) {
  const base = `http://127.0.0.1:${port}`;
  if (await responds(base, 3000)) {
    return { url: base, owned: false, mode: "prod", close: async () => {} };
  }

  const buildEnv = {
    ...process.env,
    NEXT_DIST_DIR: PROD_DIST_DIR,
    NEXT_TELEMETRY_DISABLED: "1",
  };
  const buildId = path.join(ROOT, PROD_DIST_DIR, "BUILD_ID");
  if (needsBuild({ buildIdMtime: await mtimeOf(buildId), newestSourceMtime: await newestMtime(ROOT) })) {
    log("本番ビルドを作っています（src が変わっているため。1〜2 分）");
    const built = await runBuild({ timeoutMs: buildTimeoutMs, env: buildEnv });
    if (!built.ok) {
      throw new Error(
        `本番ビルドに失敗しました（${built.reason}）。${path.relative(ROOT, built.logFile)} を見てください。`,
      );
    }
  } else {
    log(`本番ビルドは最新です（${PROD_DIST_DIR}）`);
  }

  mkdirSync(CACHE_DIR, { recursive: true });
  const logFile = path.join(CACHE_DIR, "next-start.log");
  const logFd = openSync(logFile, "w");
  const child = spawn(process.execPath, [nextBin(), "start", "-p", String(port)], {
    cwd: ROOT,
    stdio: ["ignore", logFd, logFd],
    env: buildEnv,
  });
  child.unref();

  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await responds(base, 3000)) {
      return { url: base, owned: true, mode: "prod", close: () => stopChild(child) };
    }
    if (child.exitCode !== null) {
      throw new Error(
        `next start が終了しました（${child.exitCode}）。${path.relative(ROOT, logFile)} を見てください。`,
      );
    }
    await sleep(500);
  }
  stopChild(child);
  throw new Error(
    `next start が ${Math.round(timeoutMs / 1000)} 秒以内に応答しませんでした。${path.relative(ROOT, logFile)} を見てください。`,
  );
}

/** 子プロセスを、その子ごと止める。Windows では taskkill を使う。 */
function stopChild(child) {
  if (!child?.pid) return Promise.resolve();
  if (process.platform === "win32") {
    spawn("taskkill", ["/pid", String(child.pid), "/t", "/f"], { stdio: "ignore" });
    return Promise.resolve();
  }
  child.kill("SIGTERM");
  return Promise.resolve();
}

/**
 * 対象 URL を先に開いて、Next の route をコンパイルさせる。
 *
 * 初回の遷移だけ数秒かかる。それを待機のタイムアウトに巻き込むと、
 * 「並列にしたのに 1 本目だけ遅い」形になる。先に潰しておく。
 */
export async function prewarm(targets, { tokens = {}, concurrency = 4 } = {}) {
  const queue = [...targets];
  const run = async () => {
    while (queue.length > 0) {
      const target = queue.shift();
      if (!target?.url) continue;
      const token = target.auth ? tokens[target.auth] : null;
      try {
        await httpGet(target.url, {
          headers: token ? { cookie: `auth_token=${token}` } : {},
          timeoutMs: 30000,
          follow: 3,
        });
      } catch {
        // 先読みなので、失敗しても本番の遷移で分かる。
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, targets.length) }, run));
}

/** ブラウザを用意する。既に 9333 が生きていれば繋ぐだけ。 */
export async function ensureBrowser({ port = DEFAULT_DEBUG_PORT, profilePrefix = "ui-verify" } = {}) {
  return connectBrowser({ port, profilePrefix });
}

/**
 * まとめて用意する。`close()` で、自分で立てたものだけ片付ける。
 * 既に動いていた dev サーバーは残す（次のコマンドでもそのまま使える）。
 *
 * `mode: "prod"` は本番ビルドを配る（1 リクエストが速い。全画面を回すとき用）。
 * 既定は開発サーバー（保存がそのまま反映される）。
 *
 * モックの配信は `mock:sync` では要らない（生成する側なので）ため、既定で切ってある。
 */
export async function ensureHarness({
  webPort = DEFAULT_WEB_PORT,
  prodPort = DEFAULT_PROD_PORT,
  mockPort = DEFAULT_MOCK_PORT,
  browserPort = DEFAULT_DEBUG_PORT,
  profilePrefix = "ui-verify",
  mode = "dev",
  needs = { web: true, mock: false, browser: true },
  log = () => {},
} = {}) {
  const mock = needs.mock ? await ensureMockServer({ port: mockPort }) : null;
  const web = needs.web
    ? await (mode === "prod"
        ? ensureProdServer({ port: prodPort, log })
        : ensureWebServer({ port: webPort })
      ).catch((error) => {
        mock?.close();
        throw error;
      })
    : null;

  let browser = null;
  if (needs.browser) {
    try {
      browser = await ensureBrowser({ port: browserPort, profilePrefix });
    } catch (error) {
      await web?.close();
      await mock?.close();
      throw error;
    }
  }

  let closed = false;
  return {
    webUrl: web?.url ?? `http://127.0.0.1:${mode === "prod" ? prodPort : webPort}`,
    mockUrl: mock?.url ?? `http://127.0.0.1:${mockPort}`,
    mode,
    browser,
    async close() {
      // 何度呼んでも壊れない。catch と finally の両方から呼ぶため。
      if (closed) return;
      closed = true;
      await browser?.close();
      await web?.close();
      await mock?.close();
    },
  };
}

export { waitForJson, sleep };
