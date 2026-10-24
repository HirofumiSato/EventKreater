import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

/**
 * 29 画面を 390 / 1280 で撮り、モックと同じ密度かを目で比べられるようにする。
 *
 *   npm run db:seed:ui   # 先にデータを入れる
 *   npm run ui:shots     # docs/ui-review/screens/ へ書き出す
 *
 * 追加の依存は入れない。Windows の Edge / Chrome を headless で起こし、
 * Node 24 の WebSocket で CDP を叩く。撮るたびに次の 3 つを記録する。
 *
 *   - 横スクロール（scrollWidth > innerWidth）
 *   - 画像の読み込み失敗（naturalWidth === 0）
 *   - コンソールのエラーと 400 以上のレスポンス
 *
 * ログインが要る画面は storage/ui-demo.json の JWT を Cookie に入れる。
 * 公開画面は Cookie を消してから撮る。モックは 4321 の配信をそのまま開く。
 */

const ROOT = process.cwd();
const OUT_DIR = path.join(ROOT, "docs", "ui-review", "screens");
const DATA_FILE = path.join(ROOT, "storage", "ui-demo.json");
const REPORT_FILE = path.join(OUT_DIR, "report.json");

const WIDTHS = [
  { width: 390, height: 844 },
  { width: 1280, height: 900 },
];

function parseArgs(argv) {
  const options = { only: null, withMock: true, port: 9333 };
  for (const arg of argv.slice(2)) {
    if (arg.startsWith("--only=")) {
      options.only = arg.slice("--only=".length).split(",").map((value) => value.trim());
    } else if (arg === "--no-mock") {
      options.withMock = false;
    } else if (arg.startsWith("--port=")) {
      options.port = Number(arg.slice("--port=".length));
    }
  }
  return options;
}

const options = parseArgs(process.argv);

if (!existsSync(DATA_FILE)) {
  console.error("storage/ui-demo.json がありません。先に `npm run db:seed:ui` を実行してください。");
  process.exit(1);
}

const demo = JSON.parse(await readFile(DATA_FILE, "utf8"));
const BASE = (process.env.UI_BASE_URL || demo.baseUrl || "http://localhost:3012").replace(/\/$/, "");
const MOCK_BASE = (process.env.MOCK_BASE_URL || "http://127.0.0.1:4321").replace(/\/$/, "");

if (!demo.tokens?.organizer) {
  console.error("撮影用の JWT がありません。JWT_SECRET を入れて `npm run db:seed:ui` をやり直してください。");
  process.exit(1);
}

/** 画面と、その画面が見せる状態。`slug` はファイル名になる。 */
const SCREENS = [
  { no: "01", slug: "home", path: "/", mock: "mock-home.html", auth: null },
  { no: "02", slug: "service", path: "/service", mock: "mock-service.html", auth: null },
  { no: "03", slug: "terms", path: "/terms", mock: "mock-terms.html", auth: null },
  {
    no: "04",
    slug: "event",
    mock: "mock-event.html",
    auth: null,
    states: [
      { key: "guest", label: "未ログイン", path: `/events/${demo.events.main}`, auth: null },
      {
        key: "member",
        label: "ログイン済み",
        path: `/events/${demo.events.main}`,
        auth: "participant",
      },
      { key: "full", label: "満員", path: `/events/${demo.events.full}`, auth: null },
      { key: "closed", label: "受付停止", path: `/events/${demo.events.closed}`, auth: null },
    ],
  },
  {
    no: "05",
    slug: "event-receipt",
    path: `/events/${demo.events.main}/receipt`,
    mock: "mock-event-receipt.html",
    auth: "participant",
  },
  {
    no: "06",
    slug: "organizer-public",
    path: `/organizers/${demo.organizerId}`,
    mock: "mock-organizer-public.html",
    auth: null,
  },
  {
    no: "07",
    slug: "organizer-public-events",
    path: `/organizers/${demo.organizerId}/events`,
    mock: "mock-organizer-public-events.html",
    // 催しの一覧は参加者のログインが要る。未ログインで撮ると骨組みだけになる。
    auth: "participant",
  },
  { no: "08", slug: "register", path: "/auth/register", mock: "mock-register.html", auth: null },
  {
    no: "09",
    slug: "verify",
    path: `/auth/verify?token=${demo.emailVerifyToken}`,
    mock: "mock-verify.html",
    auth: null,
  },
  {
    no: "10",
    slug: "participant-login",
    path: "/participant/login",
    mock: "mock-participant-login.html",
    auth: null,
  },
  {
    no: "11",
    slug: "invitation",
    path: `/invitations/${demo.inviteCode}`,
    mock: "mock-invitation.html",
    auth: "coHost",
  },
  { no: "12", slug: "account", path: "/account", mock: "mock-account.html", auth: "organizer" },
  {
    no: "13",
    slug: "account-verify",
    path: (width) => `/account/email/verify?token=${demo.emailChangeTokens[String(width)]}`,
    mock: "mock-account-verify.html",
    // 確定するとセッションが作り直される。他の画面の Cookie を巻き込まないよう、
    // 確認専用の会員で開く。
    auth: "verifyUser",
  },
  {
    no: "14",
    slug: "participant",
    path: "/participant",
    mock: "mock-participant.html",
    auth: "participant",
  },
  {
    no: "15",
    slug: "participant-calendar",
    path: "/participant/calendar",
    mock: "mock-participant-calendar.html",
    auth: "participant",
  },
  {
    no: "16",
    slug: "participant-history",
    mock: "mock-participant-history.html",
    auth: "participant",
    states: [
      { key: "default", label: "履歴あり", path: "/participant/history", auth: "participant" },
      { key: "empty", label: "履歴なし", path: "/participant/history", auth: "coHost" },
    ],
  },
  { no: "17", slug: "organizer", path: "/organizer/events", mock: "mock-organizer.html", auth: "organizer" },
  {
    no: "18",
    slug: "organizer-calendar",
    path: "/organizer/calendar",
    mock: "mock-organizer-calendar.html",
    auth: "organizer",
  },
  { no: "19", slug: "revenue", path: "/organizer/revenue", mock: "mock-revenue.html", auth: "organizer" },
  {
    no: "20",
    slug: "revenue-detail",
    path: `/organizer/events/${demo.events.main}/revenue`,
    mock: "mock-revenue-detail.html",
    auth: "organizer",
  },
  { no: "21", slug: "create", path: "/organizer/events/new", mock: "mock-create.html", auth: "organizer" },
  {
    no: "22",
    slug: "edit",
    path: `/organizer/events/${demo.events.main}/edit`,
    mock: "mock-edit.html",
    auth: "organizer",
  },
  {
    no: "23",
    slug: "drafts",
    path: "/organizer/events/drafts",
    mock: "mock-drafts.html",
    auth: "organizer",
  },
  {
    no: "24",
    slug: "preview",
    path: `/organizer/events/${demo.events.draft}/preview`,
    mock: "mock-preview.html",
    auth: "organizer",
  },
  {
    no: "25",
    slug: "roster",
    path: `/organizer/events/${demo.events.main}/participants`,
    mock: "mock-roster.html",
    auth: "organizer",
  },
  {
    no: "26",
    slug: "receipt",
    path: `/organizer/events/${demo.events.main}/receipts/${demo.receiptParticipant}`,
    mock: "mock-receipt.html",
    auth: "organizer",
  },
  {
    no: "27",
    slug: "register-required",
    path: `/organizer/register-required?event=${demo.events.main}`,
    mock: "mock-register-required.html",
    auth: null,
  },
  {
    no: "28",
    slug: "organizer-profile",
    path: "/organizer/profile",
    mock: "mock-organizer-profile.html",
    auth: "organizer",
  },
  { no: "29", slug: "mypage", path: "/mypage", mock: "mock-mypage.html", auth: "organizer" },
];

/** 状態を持つ画面は状態ごとに 1 枚、持たない画面は 1 枚。 */
function expand(screeens) {
  const rows = [];
  for (const screen of screeens) {
    const states = screen.states ?? [{ key: "default", label: "", path: screen.path, auth: screen.auth }];
    for (const state of states) {
      const suffix = state.key === "default" ? "" : `-${state.key}`;
      rows.push({
        no: screen.no,
        slug: screen.slug,
        mock: screen.mock,
        stateKey: state.key,
        label: state.label,
        auth: state.auth ?? null,
        path: state.path,
        fileName: `${screen.no}-${screen.slug}${suffix}`,
      });
    }
  }
  return rows;
}

const rows = expand(SCREENS).filter(
  (row) => !options.only || options.only.includes(row.no) || options.only.includes(row.fileName),
);

function findBrowser() {
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

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * 期待どおりの応答。撮影のたびに必ず出るので、異常として数えない。
 * - /favicon.ico の 404: 未配置。
 * - /api/v1/user/profile の 401: 未ログインの確認。公開画面では正常。
 * - /api/v1/auth/session の 401: ログイン画面で「未ログイン」を確認している。
 * - 主催者の催し一覧の 403: 未ログインでは骨組みだけを出す仕様。
 */
const EXPECTED_HTTP = [
  { pattern: /\/favicon\.ico$/, statuses: [404] },
  { pattern: /\/api\/v1\/user\/profile$/, statuses: [401] },
  { pattern: /\/api\/v1\/auth\/session$/, statuses: [401] },
  { pattern: /\/api\/v1\/public\/organizers\/[^/]+\/events$/, statuses: [403] },
];

function isExpectedHttpError(url, status) {
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

/** 最小限の CDP クライアント。flatten した 1 セッションだけを扱う。 */
class Cdp {
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
        for (const listener of this.listeners.get(message.method) ?? []) listener(message.params);
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

async function waitForJson(url, timeoutMs) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok) return await res.json();
    } catch {
      // 起動待ち。まだ listen していない。
    }
    await sleep(200);
  }
  throw new Error(`デバッグ用の応答がありません: ${url}`);
}

const browserPath = findBrowser();
if (!browserPath) {
  console.error("Edge / Chrome が見つかりません。UI_SHOT_BROWSER に実行ファイルを指定してください。");
  process.exit(1);
}

const profileDir = path.join(tmpdir(), `ui-shots-${process.pid}`);
const browser = spawn(
  browserPath,
  [
    "--headless=new",
    `--remote-debugging-port=${options.port}`,
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
  { stdio: "ignore" },
);

let cdp = null;
const findings = [];
const report = [];

try {
  const version = await waitForJson(`http://127.0.0.1:${options.port}/json/version`, 20000);
  const socket = new WebSocket(version.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", () => reject(new Error("CDP に接続できませんでした")), {
      once: true,
    });
  });
  cdp = new Cdp(socket);

  const { targetInfos } = await cdp.send("Target.getTargets");
  const pageTarget = targetInfos.find((target) => target.type === "page");
  const { sessionId } = await cdp.send("Target.attachToTarget", {
    targetId: pageTarget.targetId,
    flatten: true,
  });

  await cdp.send("Page.enable", {}, sessionId);
  await cdp.send("Runtime.enable", {}, sessionId);
  await cdp.send("Network.enable", {}, sessionId);

  let consoleErrors = [];
  let httpErrors = [];
  cdp.on("Runtime.consoleAPICalled", (params) => {
    if (params.type !== "error") return;
    const text = params.args
      .map((arg) => arg.value ?? arg.description ?? arg.preview?.description ?? "")
      .join(" ")
      .slice(0, 300);
    consoleErrors.push(text);
  });
  cdp.on("Runtime.exceptionThrown", (params) => {
    const detail = params.exceptionDetails;
    consoleErrors.push(
      `${detail.text}${detail.exception?.description ? ` ${detail.exception.description}` : ""}`.slice(0, 300),
    );
  });
  cdp.on("Network.responseReceived", (params) => {
    if (params.response.status >= 400 && !isExpectedHttpError(params.response.url, params.response.status)) {
      httpErrors.push(`${params.response.status} ${params.response.url}`.slice(0, 200));
    }
  });

  async function evaluate(expression) {
    const result = await cdp.send(
      "Runtime.evaluate",
      { expression, returnByValue: true, awaitPromise: true },
      sessionId,
    );
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.text ?? "評価に失敗しました");
    }
    return result.result.value;
  }

  async function waitForReady(url) {
    const loaded = new Promise((resolve) => {
      const off = cdp.on("Page.loadEventFired", () => {
        off();
        resolve();
      });
      setTimeout(() => {
        off();
        resolve();
      }, 30000);
    });
    await cdp.send("Page.navigate", { url }, sessionId);
    await loaded;
    const started = Date.now();
    while (Date.now() - started < 20000) {
      try {
        const ready = await evaluate(`(() => {
          const loading = document.querySelectorAll(".loading").length;
          const images = Array.from(document.images);
          const pending = images.filter((image) => !image.complete).length;
          return document.readyState === "complete" && loading === 0 && pending === 0;
        })()`);
        if (ready) return;
      } catch {
        // 遷移中は評価できないことがある。
      }
      await sleep(120);
    }
  }

  async function applyAuth(auth) {
    await cdp.send("Network.clearBrowserCookies", {}, sessionId);
    if (!auth) return;
    const token = demo.tokens[auth];
    if (!token) throw new Error(`トークンがありません: ${auth}`);
    const result = await cdp.send(
      "Network.setCookie",
      { name: "auth_token", value: token, url: `${BASE}/`, path: "/", httpOnly: true, sameSite: "Lax" },
      sessionId,
    );
    if (!result.success) throw new Error(`Cookie を設定できませんでした: ${auth}`);
  }

  async function capture(fileName, width) {
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
    const filePath = path.join(OUT_DIR, `${fileName}-${width}.png`);
    await writeFile(filePath, Buffer.from(shot.data, "base64"));
    return { filePath, height: Math.ceil(size.height) };
  }

  async function shoot(url, auth, fileName, width, label) {
    consoleErrors = [];
    httpErrors = [];
    // 実装ページが投げたままの fetch が、モックを開いた後に 401 として届く。
    // 一度 about:blank へ離れてから、記録を空にして撮る。
    if (url.startsWith(MOCK_BASE)) {
      await cdp.send("Page.navigate", { url: "about:blank" }, sessionId);
      await sleep(250);
      consoleErrors = [];
      httpErrors = [];
    }
    await applyAuth(auth);
    await waitForReady(url);
    await sleep(450);
    const audit = await evaluate(`(() => {
      const doc = document.documentElement;
      const broken = Array.from(document.images)
        .filter((image) => image.complete && image.naturalWidth === 0)
        .map((image) => image.currentSrc || image.src);
      return {
        scrollWidth: doc.scrollWidth,
        innerWidth: window.innerWidth,
        brokenImages: broken,
        title: document.title,
      };
    })()`);
    const { height } = await capture(fileName, width);

    const row = {
      screen: fileName,
      label,
      url,
      width,
      height,
      scrollWidth: audit.scrollWidth,
      overflow: Math.max(0, audit.scrollWidth - audit.innerWidth),
      brokenImages: audit.brokenImages,
      consoleErrors: [...new Set(consoleErrors)].slice(0, 6),
      httpErrors: [...new Set(httpErrors)].slice(0, 6),
      title: audit.title,
    };
    report.push(row);
    const problems = [];
    if (row.overflow > 0) problems.push(`横はみ出し ${row.overflow}px`);
    if (row.brokenImages.length) problems.push(`画像 ${row.brokenImages.length} 件`);
    if (row.consoleErrors.length) problems.push(`console ${row.consoleErrors.length} 件`);
    if (row.httpErrors.length) problems.push(`HTTP ${row.httpErrors.length} 件`);
    if (problems.length) findings.push({ file: `${fileName}-${width}.png`, problems, row });
    const mark = problems.length ? "!" : " ";
    console.log(
      `${mark} ${fileName}-${width}.png  h=${height}${label ? `  (${label})` : ""}${
        problems.length ? `  ${problems.join(" / ")}` : ""
      }`,
    );
    return row;
  }

  await mkdir(OUT_DIR, { recursive: true });

  let mockAvailable = options.withMock;
  if (mockAvailable) {
    try {
      const res = await fetch(`${MOCK_BASE}/style-guide/mock-screens-data.js`);
      mockAvailable = res.ok;
    } catch {
      mockAvailable = false;
    }
    if (!mockAvailable) console.log("モック配信（4321）に繋がらないため、モックの撮影は飛ばします。");
    else await mkdir(path.join(OUT_DIR, "mock"), { recursive: true });
  }

  for (const width of WIDTHS) {
    await cdp.send(
      "Emulation.setDeviceMetricsOverride",
      {
        width: width.width,
        height: width.height,
        deviceScaleFactor: 1,
        mobile: width.width < 600,
      },
      sessionId,
    );
    // 端末のダーク設定でモックだけ自動反転すると、実装との比較にならない。
    await cdp.send(
      "Emulation.setEmulatedMedia",
      { media: "", features: [{ name: "prefers-color-scheme", value: "light" }] },
      sessionId,
    );
    for (const row of rows) {
      const appPath = typeof row.path === "function" ? row.path(width.width) : row.path;
      await shoot(`${BASE}${appPath}`, row.auth, row.fileName, width.width, row.label);
      if (mockAvailable && row.mock && row.stateKey === "default") {
        await shoot(
          `${MOCK_BASE}/style-guide/${row.mock}`,
          null,
          `mock/${row.fileName}`,
          width.width,
          "モック",
        );
      }
    }
  }

  await cdp.send("Emulation.clearDeviceMetricsOverride", {}, sessionId).catch(() => {});

  await writeFile(
    REPORT_FILE,
    `${JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        baseUrl: BASE,
        mockBaseUrl: mockAvailable ? MOCK_BASE : null,
        note: "overflow は scrollWidth - innerWidth。0 以外は横スクロールが出ている。",
        screens: report,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );

  console.log("");
  console.log(`撮影 ${report.length} 枚 → ${path.relative(ROOT, OUT_DIR)}`);
  if (findings.length === 0) {
    console.log("横スクロール・画像 404・コンソールエラーはありませんでした。");
  } else {
    console.log(`確認が要る枚数: ${findings.length}`);
    for (const finding of findings) {
      console.log(`- ${finding.file}: ${finding.problems.join(" / ")}`);
      for (const error of finding.row.consoleErrors) console.log(`    console: ${error}`);
      for (const error of finding.row.httpErrors) console.log(`    http: ${error}`);
      for (const image of finding.row.brokenImages) console.log(`    image: ${image}`);
    }
  }
} finally {
  try {
    await cdp?.send("Browser.close");
  } catch {
    // 既に閉じている。
  }
  browser.kill();
  await rm(profileDir, { recursive: true, force: true }).catch(() => {});
}
