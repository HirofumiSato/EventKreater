/**
 * 公開クロム（ヘッダー・フッター）と上端の余白を、パスだけから決める純関数。
 *
 * - `/console`     … 管理コンソール。公開ヘッダーもフッターも出さない。
 * - `/`            … ホーム LP。初見の幹事にヒーローだけを見せるため、ヘッダーを出さず、
 *                    上端の余白も落とす。ログインの導線はヒーローとフッターが持つ。
 * - `/events/`     … 告知ページと領収書。共有された催しに集中させるため、共通ヘッダーは
 *                    出さない。フッターは残す。告知ページだけ上端の余白も落とし、チラシを
 *                    画面の上端から始める。`/organizer/events/` は主催者エリアなので対象外。
 * - `/organizers/` … 主催者の公開ページ。プロフィールと催しに集中させるため、
 *                    共通ヘッダーは出さない。フッターは残す。
 * - それ以外       … 公開ヘッダーとフッターを出す。
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

/** 主催者の公開ページ。`/organizer`（主催者エリア）とは別のプレフィックス。 */
function inOrganizerPublic(pathname: string): boolean {
  return pathname === "/organizers" || pathname.startsWith("/organizers/");
}

/**
 * 公開の告知と領収書。`/organizer/events/` は `startsWith("/events/")` にならない。
 * ID なしの `/events` はホームへリダイレクトするが、接頭辞として同じ扱いにする。
 */
function inEventPublic(pathname: string): boolean {
  return pathname === "/events" || pathname.startsWith("/events/");
}

/** `/events/[id]` のみ。領収書 `/events/[id]/receipt` は上端余白を残す。 */
function inEventAnnouncement(pathname: string): boolean {
  if (!pathname.startsWith("/events/")) return false;
  const rest = pathname.slice("/events/".length);
  return rest.length > 0 && !rest.includes("/");
}

export function siteChrome(pathname: string): SiteChromeState {
  if (inConsole(pathname)) {
    return { header: false, footer: false, flushTop: false };
  }
  if (pathname === "/") {
    return { header: false, footer: true, flushTop: true };
  }
  if (inOrganizerPublic(pathname)) {
    return { header: false, footer: true, flushTop: false };
  }
  if (inEventPublic(pathname)) {
    return {
      header: false,
      footer: true,
      flushTop: inEventAnnouncement(pathname),
    };
  }
  return { header: true, footer: true, flushTop: false };
}
