/**
 * 公開クロム（ヘッダー・フッター）と上端の余白を、パスだけから決める純関数。
 *
 * - `/console` … 管理コンソール。公開ヘッダーもフッターも出さない。
 * - `/`       … ホーム LP。初見の幹事にヒーローだけを見せるため、ヘッダーを出さず、
 *               上端の余白も落とす。ログインの導線はヒーローとフッターが持つ。
 * - それ以外 … 公開ヘッダーとフッターを出す。
 *
 * 判定を `SiteChrome` の中に置くと、増えたときに分岐が散る。ここ 1 か所に集める。
 */
export interface SiteChromeState {
  /** 共通ヘッダー（`Navbar`）を出すか。 */
  readonly header: boolean;
  /** フッターを出すか。 */
  readonly footer: boolean;
  /** `main` の上端の余白を落とすか。ヘッダーを出さない画面だけが true。 */
  readonly flushTop: boolean;
}

/** 前方一致はパスの区切りまで見る。`/consolelike` を `/console` と誤認しないため。 */
function inConsole(pathname: string): boolean {
  return pathname === "/console" || pathname.startsWith("/console/");
}

export function siteChrome(pathname: string): SiteChromeState {
  if (inConsole(pathname)) {
    return { header: false, footer: false, flushTop: false };
  }
  if (pathname === "/") {
    return { header: false, footer: true, flushTop: true };
  }
  return { header: true, footer: true, flushTop: false };
}
