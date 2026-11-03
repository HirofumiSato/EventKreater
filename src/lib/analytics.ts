/**
 * Google Analytics 4（gtag.js）への送信。
 *
 * 送らない条件は 2 つだけ。測定 ID が空のときと、本番（`NODE_ENV === "production"`）でないとき。
 * 開発サーバーの操作を集計に入れないため、判定はここ 1 か所に集める。
 *
 * 送信は `window.dataLayer` への push で行う。gtag.js の読み込み前に呼ばれても、
 * 配列に積まれるだけで gtag.js が後から拾う。サーバーとテスト（window が無い）では何もしない。
 *
 * `window.gtag` があればそちらを使う。gtag.js が読むのは dataLayer に積まれた arguments で、
 * コマンド形（`gtag("event", ...)`）の方が素のオブジェクトより確実に拾われるため。
 */

/** ビルド時に焼き込まれる測定 ID。`NEXT_PUBLIC_` は静的な参照でないと置き換わらない。 */
export const GA_MEASUREMENT_ID = (process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID ?? "").trim();

/** UUID の節を `:id` に寄せる。形は `src/lib/ids.ts` の判定と同じ。 */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 集計から外すパス。`/consolex` のような別パスは除外しない。 */
function inConsole(pathname: string): boolean {
  return pathname === "/console" || pathname.startsWith("/console/");
}

interface GtagWindow extends Window {
  dataLayer?: unknown[];
  /** インライン script が置くスタブ。読み込み前は arguments を dataLayer へ積むだけ。 */
  gtag?: (...args: unknown[]) => void;
}

/**
 * 計測してよいかを決める。
 *
 * 引数を省略したときはビルド時の環境変数を見る。テストからは明示引数で呼ぶ。
 */
export function analyticsEnabled(
  measurementId: string = process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID ?? "",
  nodeEnv: string = process.env.NODE_ENV ?? "",
): boolean {
  if ((measurementId ?? "").trim() === "") return false;
  return (nodeEnv ?? "") === "production";
}

/**
 * 送るパスへ正規化する。除外する画面なら `null`。
 *
 * クエリとハッシュは落とす。招待コードや紹介コードを集計へ載せないため。
 * UUID の節は `:id`、`/invitations/<code>` のコード節は `:code` に寄せる。
 */
export function analyticsPagePath(pathname: string): string | null {
  if (typeof pathname !== "string") return null;
  // クエリ・ハッシュはパスではないので、先に切る。
  let path = pathname;
  const cut = path.search(/[?#]/);
  if (cut >= 0) path = path.slice(0, cut);
  // 絶対 URL で来たときはパスだけを見る。URL として読めない値は捨てる。
  if (/^[a-z][a-z0-9+.-]*:/i.test(path)) {
    try {
      path = new URL(path).pathname;
    } catch {
      return null;
    }
  }
  // パスでない値（空文字や相対の文字列）は送らない。
  if (!path.startsWith("/")) return null;
  if (inConsole(path)) return null;
  // 末尾スラッシュは落とす。ルート（`/`）だけは残す。
  if (path.length > 1 && path.endsWith("/")) path = path.slice(0, -1);

  const segments = path.split("/");
  for (let i = 0; i < segments.length; i += 1) {
    const segment = segments[i];
    if (UUID_PATTERN.test(segment)) {
      segments[i] = ":id";
    }
  }
  // 招待コードは `:code` に寄せる。コード自体は集計に残さない。
  if (segments[1] === "invitations" && segments.length > 2 && segments[2]) {
    segments[2] = ":code";
  }
  return segments.join("/");
}

/** 送れる状態かを確かめ、window を型付きで返す。サーバーと無効時は null。 */
function windowForSend(): GtagWindow | null {
  if (typeof window === "undefined") return null;
  if (!analyticsEnabled()) return null;
  return window as GtagWindow;
}

/**
 * 1 件を送る。dataLayer へ積むのはここ 1 か所だけ。
 *
 * gtag があればコマンド形で渡す（gtag.js は dataLayer の arguments を読むため）。
 * 無ければ素のオブジェクトを積み、読み込み後に拾わせる。
 */
function sendEvent(name: string, params: Record<string, unknown>): void {
  const target = windowForSend();
  if (!target) return;
  if (typeof target.gtag === "function") {
    target.gtag("event", name, params);
    return;
  }
  target.dataLayer = target.dataLayer ?? [];
  target.dataLayer.push({ event: name, ...params });
}

/** 画面の表示を 1 回だけ送る。`page_location` はクエリを含めない。 */
export function trackPageView(pathname: string, title?: string): void {
  if (!windowForSend()) return;
  const pagePath = analyticsPagePath(pathname);
  if (!pagePath) return;
  const pageTitle = title ?? (typeof document === "undefined" ? "" : document.title);
  const origin = typeof window.location?.origin === "string" ? window.location.origin : "";
  sendEvent("page_view", {
    page_path: pagePath,
    page_title: pageTitle,
    page_location: `${origin}${pagePath}`,
  });
}

/** 主要操作を送る。gtag.js がまだ無くても dataLayer に積んでおく。 */
export function trackEvent(name: string, params?: Record<string, unknown>): void {
  sendEvent(name, params ?? {});
}
