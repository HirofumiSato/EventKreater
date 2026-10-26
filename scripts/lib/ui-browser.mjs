// モックを撮るための、最小の CDP クライアント。
//
//   npm run mock:sync  … 製品の画面を開いて HTML と PNG を取る（scripts/mock-sync.mjs）
//
// ブラウザの起動・待機・Cookie・端末幅の扱いをここ 1 か所に寄せ、
// 呼び出し側が条件をばらばらに組み立てないようにする。
//
// 2 層に分けてある。
//
//   connectBrowser … ブラウザを 1 つ用意する。既に 9333 が生きていれば繋ぐだけ。
//   openTarget     … そのブラウザにタブを 1 つ足す。isolate なら Cookie も分ける。
//
// 追加の依存は入れない。Windows の Edge / Chrome を headless で起こし、
// Node 24 の WebSocket で CDP を叩く。

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { httpGetJson } from "./ui-http.mjs";

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** 既定のデバッグ用ポート。mock-screens.mjs の DEFAULT_DEBUG_PORT と同じ番号。 */
export const DEFAULT_DEBUG_PORT = 9333;

/** 期待どおりの応答。撮影・比較のたびに必ず出るので、異常として数えない。 */
export const EXPECTED_HTTP = [
  { pattern: /\/favicon\.ico$/, statuses: [404] },
  { pattern: /\/api\/v1\/user\/profile$/, statuses: [401] },
  { pattern: /\/api\/v1\/auth\/session$/, statuses: [401] },
  { pattern: /\/api\/v1\/public\/organizers\/[^/]+\/events$/, statuses: [403] },
];

export function isExpectedHttpError(url, status) {
  let pathname;
  try {
    pathname = new URL(url).pathname;
  } catch {
    return false;
  }
  return EXPECTED_HTTP.some(
    (entry) => entry.pattern.test(pathname) && entry.statuses.includes(status),
  );
}

export function findBrowser() {
  const candidates = [
    process.env.UI_SHOT_BROWSER,
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/microsoft-edge",
  ].filter(Boolean);
  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

export function requireBrowser() {
  const browserPath = findBrowser();
  if (!browserPath) {
    throw new Error("Edge / Chrome が見つかりません。UI_SHOT_BROWSER に実行ファイルを指定してください。");
  }
  return browserPath;
}

export function profileDirFor(prefix) {
  return path.join(tmpdir(), `${prefix}-${process.pid}`);
}

/** headless のブラウザを起こす。止め忘れを防ぐため、呼び出し側が必ず kill する。 */
export function launchBrowser({ browserPath, port, profileDir }) {
  const child = spawn(
    browserPath,
    [
      "--headless=new",
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${profileDir}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-extensions",
      "--disable-background-networking",
      "--disable-sync",
      "--hide-scrollbars",
      "--force-device-scale-factor=1",
      "--window-size=1280,900",
      "about:blank",
    ],
    { stdio: "ignore", detached: process.platform !== "win32" },
  );
  // 子プロセスの handle は、それだけで Node のイベントループを生かし続ける。
  // ブラウザは Browser.close で閉じるので、待たせない。
  child.unref();
  return child;
}

/**
 * 起動したブラウザを、別のコマンドからも使い回せるように控える。
 * 置き場所は node_modules/.cache/ui-harness/（.gitignore 済み）。
 */
const STATE_DIR = path.join(process.cwd(), "node_modules", ".cache", "ui-harness");
const STATE_FILE = path.join(STATE_DIR, "browser.json");

function writeState(state) {
  try {
    mkdirSync(STATE_DIR, { recursive: true });
    writeFileSync(STATE_FILE, `${JSON.stringify(state)}\n`, "utf8");
  } catch {
    // 控えられなくても、動作には影響しない。
  }
}

function clearState() {
  rmSync(STATE_FILE, { force: true });
}

/** 最小限の CDP クライアント。flatten したセッションを複数同時に扱える。 */
export class Cdp {
  constructor(socket) {
    this.socket = socket;
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Map();
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (message.id && this.pending.has(message.id)) {
        const { resolve, reject } = this.pending.get(message.id);
        this.pending.delete(message.id);
        if (message.error) reject(new Error(`${message.error.message} (${message.error.code})`));
        else resolve(message.result);
        return;
      }
      if (message.method) {
        // タブが複数あると、同じ種類のイベントが別のセッションからも届く。
        // 呼び出し側が sessionId で選べるように、第 2 引数で渡す。
        for (const listener of this.listeners.get(message.method) ?? []) {
          listener(message.params, message.sessionId);
        }
      }
    });
    socket.addEventListener("close", () => {
      for (const { reject } of this.pending.values()) reject(new Error("CDP 接続が閉じました"));
      this.pending.clear();
    });
  }

  on(method, listener) {
    const list = this.listeners.get(method) ?? [];
    list.push(listener);
    this.listeners.set(method, list);
    return () => {
      const current = this.listeners.get(method) ?? [];
      this.listeners.set(
        method,
        current.filter((item) => item !== listener),
      );
    };
  }

  send(method, params = {}, sessionId) {
    const id = this.nextId++;
    const payload = { id, method, params };
    if (sessionId) payload.sessionId = sessionId;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify(payload));
      const timer = setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`${method} が 30 秒で返りませんでした`));
        }
      }, 30000);
      timer.unref?.();
    });
  }
}

export async function waitForJson(url, timeoutMs) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const json = await httpGetJson(url, { timeoutMs: 2000 });
    if (json) return json;
    await sleep(150);
  }
  throw new Error(`デバッグ用の応答がありません: ${url}`);
}

/** 取得の完了を待つための計測。画面側の fetch を包み、未完了の本数を数える。 */
const PENDING_FETCH_SCRIPT = `(() => {
  window.__pendingFetches = 0;
  const original = window.fetch;
  window.fetch = function (...args) {
    window.__pendingFetches += 1;
    return original.apply(this, args).finally(() => {
      window.__pendingFetches -= 1;
    });
  };
})();`;

/**
 * 待機の刻み。待つ条件そのものは fast も strict も同じで、刻みだけが違う。
 *
 *   strict … 従来の値。1 遷移あたり最低 800ms 待つ。
 *   fast   … 100ms 刻みで 3 回連続を確かめる。最低 300ms。
 *
 * 条件に `document.fonts` を足したぶん、fast のほうが「待つ中身」は厳しい。
 * 書体が後から届いて行が動く瞬間を撮らないため。
 */
export const WAIT_PROFILES = {
  fast: { readyDelay: 100, busyDelay: 60, stableCount: 3, settle: 120 },
  strict: { readyDelay: 400, busyDelay: 120, stableCount: 2, settle: 450 },
};

// 従来の待機。--strict を付けたときはこちらを使う。
export const DEFAULT_WAIT_PROFILE = "fast";

/**
 * ブラウザを 1 つ用意する。
 *
 * 既にデバッグ用ポートが生きていれば、起動せずに繋ぐ（`owned: false`）。
 * 常駐ハーネス（scripts/lib/ui-harness.mjs）が起こしたブラウザを、
 * 次のコマンドがそのまま使えるようにするため。繋いだ場合は close() で落とさない。
 */export async function connectBrowser({
  port = DEFAULT_DEBUG_PORT,
  profilePrefix = "ui-page",
  timeoutMs = 20000,
  reuse = true,
} = {}) {
  let version = null;
  if (reuse) {
    try {
      version = await waitForJson(`http://127.0.0.1:${port}/json/version`, 600);
    } catch {
      version = null;
    }
  }

  let browserProcess = null;
  let profileDir = null;
  let reused = version !== null;

  if (!reused) {
    // 前回の控えは消すだけにする。PID は再利用されることがあり、
    // 記録が古いときに kill すると無関係なプロセスを落とす危険がある。
    clearState();

    const browserPath = requireBrowser();
    profileDir = profileDirFor(profilePrefix);
    browserProcess = launchBrowser({ browserPath, port, profileDir });
    version = await waitForJson(`http://127.0.0.1:${port}/json/version`, timeoutMs);
    writeState({ pid: browserProcess.pid, port, profileDir, browserPath });
  }

  const socket = new WebSocket(version.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", () => reject(new Error("CDP に接続できませんでした")), {
      once: true,
    });
  });
  const cdp = new Cdp(socket);

  // ブラウザ本体の PID を控える。Browser.close は丁寧な分、こちらの WebSocket が
  // 閉じきらずにプロセスが終わらないことがある（30 秒ほど待たされる）。
  // 落とすのは確実にするため、CDP に聞いた本体の PID を使う。
  let browserPid = null;
  try {
    const { processInfo } = await cdp.send("SystemInfo.getProcessInfo");
    browserPid = processInfo.find((process) => process.type === "browser")?.id ?? null;
  } catch {
    browserPid = browserProcess?.pid ?? null;
  }

  return {
    cdp,
    port,
    owned: !reused,
    profileDir,
    browserPid,
    close: async () => {
      if (!reused) {
        // 先に落としてから接続を閉じる。逆だと close の握手が返らず、
        // Node のイベントループが残ってコマンドが終わらない。
        try {
          if (browserPid) process.kill(browserPid, "SIGKILL");
        } catch {
          // 既に終わっている。
        }
        try {
          browserProcess?.kill();
        } catch {
          // 既に終わっている。
        }
        await sleep(120);
      }
      try {
        socket.close();
      } catch {
        // 接続は既に切れている。
      }
      if (browserProcess) clearState();
    },
  };
}

/**
 * ブラウザにタブを 1 つ足し、そのタブだけを操作する一式を返す。
 *
 * `isolate: true` のときは、タブごとに Cookie の入れ物（ブラウザコンテキスト）を
 * 分ける。並列に走らせても、片方のログインが片方の Cookie を消さない。
 */
export async function openTarget(
  browser,
  { isolate = false, baseUrl, tokens = {}, waitProfile = DEFAULT_WAIT_PROFILE } = {},
) {
  const { cdp } = browser;
  const timings = WAIT_PROFILES[waitProfile] ?? WAIT_PROFILES.fast;

  let browserContextId = null;
  if (isolate) {
    ({ browserContextId } = await cdp.send("Target.createBrowserContext"));
  }
  const { targetId } = await cdp.send("Target.createTarget", {
    url: "about:blank",
    ...(browserContextId ? { browserContextId } : {}),
  });
  const { sessionId } = await cdp.send("Target.attachToTarget", { targetId, flatten: true });

  let consoleErrors = [];
  let httpErrors = [];

  await cdp.send("Page.enable", {}, sessionId);
  await cdp.send("Runtime.enable", {}, sessionId);
  await cdp.send("Network.enable", {}, sessionId);
  await cdp.send("Page.addScriptToEvaluateOnNewDocument", { source: PENDING_FETCH_SCRIPT }, sessionId);

  const mine = (eventSessionId) => eventSessionId === sessionId;

  cdp.on("Runtime.consoleAPICalled", (params, eventSessionId) => {
    if (!mine(eventSessionId)) return;
    if (params.type !== "error") return;
    const text = params.args
      .map((arg) => arg.value ?? arg.description ?? arg.preview?.description ?? "")
      .join(" ")
      .slice(0, 300);
    consoleErrors.push(text);
  });
  cdp.on("Runtime.exceptionThrown", (params, eventSessionId) => {
    if (!mine(eventSessionId)) return;
    const detail = params.exceptionDetails;
    consoleErrors.push(
      `${detail.text}${detail.exception?.description ? ` ${detail.exception.description}` : ""}`.slice(0, 300),
    );
  });
  cdp.on("Network.responseReceived", (params, eventSessionId) => {
    if (!mine(eventSessionId)) return;
    if (
      params.response.status >= 400 &&
      !isExpectedHttpError(params.response.url, params.response.status)
    ) {
      httpErrors.push(`${params.response.status} ${params.response.url}`.slice(0, 200));
    }
  });

  const evaluate = async (expression) => {
    const result = await cdp.send(
      "Runtime.evaluate",
      { expression, returnByValue: true, awaitPromise: true },
      sessionId,
    );
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.text ?? "評価に失敗しました");
    }
    return result.result.value;
  };

  const navigate = async (url) => {
    const loaded = new Promise((resolve) => {
      let timer = null;
      const off = cdp.on("Page.loadEventFired", (params, eventSessionId) => {
        if (!mine(eventSessionId)) return;
        // 読み込みが返ったらタイマーを必ず片付ける。残すとその 30 秒のあいだ
        // Node のイベントループが生き続け、コマンドが終わらない。
        if (timer) clearTimeout(timer);
        off();
        resolve();
      });
      timer = setTimeout(() => {
        off();
        resolve();
      }, 30000);
    });
    await cdp.send("Page.navigate", { url }, sessionId);
    await loaded;
  };

  const applyAuth = async (auth) => {
    // 消すのは自分たちが入れた Cookie だけにする。ブラウザ全体を消すと、
    // 並列に走っている別のタブのログインまで巻き込む。
    if (baseUrl) {
      await cdp.send(
        "Network.deleteCookies",
        { name: "auth_token", url: `${baseUrl}/` },
        sessionId,
      );
    } else {
      await cdp.send("Network.clearBrowserCookies", {}, sessionId);
    }
    if (!auth) return;
    const token = tokens[auth];
    if (!token) throw new Error(`トークンがありません: ${auth}`);
    const result = await cdp.send(
      "Network.setCookie",
      { name: "auth_token", value: token, url: `${baseUrl}/`, path: "/", httpOnly: true, sameSite: "Lax" },
      sessionId,
    );
    if (!result.success) throw new Error(`Cookie を設定できませんでした: ${auth}`);
  };

  const waitForStable = async ({ timeoutMs: limit = 25000, profile = waitProfile } = {}) => {
    const step = WAIT_PROFILES[profile] ?? timings;
    const started = Date.now();
    let stable = 0;
    let lastLength = -1;
    while (Date.now() - started < limit) {
      let ready = false;
      let length = -1;
      try {
        const state = await evaluate(`(() => {
          const loading = document.querySelectorAll(".loading").length;
          const images = Array.from(document.images);
          const pending = images.filter((image) => !image.complete).length;
          return {
            ready:
              document.readyState === "complete" &&
              loading === 0 &&
              pending === 0 &&
              (window.__pendingFetches ?? 0) === 0 &&
              (document.fonts?.status ?? "loaded") !== "loading",
            length: (document.body.innerText || "").length,
          };
        })()`);
        ready = state.ready;
        length = state.length;
      } catch {
        // 遷移中は評価できないことがある。
      }
      // 取得の途中で「読み込んでいます」のまま撮らないよう、本文の長さが
      // 続けて同じになるまで待つ（最大 25 秒）。
      if (ready && length > 0 && length === lastLength) {
        stable += 1;
        if (stable >= step.stableCount) return;
      } else {
        stable = 0;
      }
      lastLength = length;
      await sleep(ready ? step.readyDelay : step.busyDelay);
    }
  };

  const waitForReady = async (url) => {
    await navigate(url);
    await waitForStable();
  };

  const setViewport = async (width, height) => {
    await cdp.send(
      "Emulation.setDeviceMetricsOverride",
      { width, height, deviceScaleFactor: 1, mobile: width < 600 },
      sessionId,
    );
    // 端末のダーク設定でモックだけ自動反転すると、実装との比較にならない。
    await cdp.send(
      "Emulation.setEmulatedMedia",
      { media: "", features: [{ name: "prefers-color-scheme", value: "light" }] },
      sessionId,
    );
  };

  const clearViewport = async () => {
    await cdp.send("Emulation.clearDeviceMetricsOverride", {}, sessionId).catch(() => {});
  };

  const captureScreenshot = async () => {
    const metrics = await cdp.send("Page.getLayoutMetrics", {}, sessionId);
    const size = metrics.cssContentSize ?? metrics.contentSize;
    const shot = await cdp.send(
      "Page.captureScreenshot",
      {
        format: "png",
        captureBeyondViewport: true,
        clip: {
          x: 0,
          y: 0,
          width: Math.ceil(size.width),
          height: Math.ceil(Math.max(size.height, 1)),
          scale: 1,
        },
      },
      sessionId,
    );
    return { data: Buffer.from(shot.data, "base64"), height: Math.ceil(size.height) };
  };

  // 記録を空にする。モックを開く前後で実装の取りこぼしが混ざらないようにする。
  const resetErrors = () => {
    consoleErrors = [];
    httpErrors = [];
  };

  const takeErrors = () => ({
    consoleErrors: [...new Set(consoleErrors)].slice(0, 6),
    httpErrors: [...new Set(httpErrors)].slice(0, 6),
  });

  return {
    cdp,
    sessionId,
    targetId,
    browserContextId,
    waitProfile,
    applyAuth,
    evaluate,
    navigate,
    waitForReady,
    waitForStable,
    setViewport,
    clearViewport,
    captureScreenshot,
    resetErrors,
    takeErrors,
    /** タブだけを閉じる。ブラウザは残す（次のタブが使う）。 */
    async close() {
      try {
        if (browserContextId) await cdp.send("Target.disposeBrowserContext", { browserContextId });
        else await cdp.send("Target.closeTarget", { targetId });
      } catch {
        // 既に閉じている。
      }
    },
  };
}
