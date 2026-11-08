/**
 * 公開クロム（ヘッダー・フッター）と上端の余白を、パスだけから決める純関数。
 *
 * - `/console`     … 管理コンソール。公開ヘッダーもフッターも出さない。
 * - `/`            … ホーム LP。初見の主催者にヒーローだけを見せるため、ヘッダーを出さず、
 *                    上端の余白も落とす。ログインの導線はヒーローとフッターが持つ。
 * - `/events/`     … 告知ページ。共有されたイベントに集中させるため、共通ヘッダーは
 *                    出さない。フッターは残す。告知ページだけ上端の余白も落とし、チラシを
 *                    画面の上端から始める。`/organizer/events/` は主催者エリアなので対象外。
 * - `/sample`      … 告知ページの見本。本物の告知ページと同じ面に集中させるため、共通
 *                    ヘッダーは出さない。代わりに上端の帯（`SampleBand`）がクロムになる。
 *                    フッターは残し、上端の余白も落として帯を画面の上端から始める。
 * - `/organizers/` … 主催者の公開ページ。プロフィールとイベントに集中させるため、
 *                    共通ヘッダーは出さない。フッターは残す。
 * - テーマ付きの公開ページ（`/events/[id]`・`/organizers/[userId]`・`/invite/[code]`・
 *   `/sample/[slug]`・`/sample/profile/[slug]`）… フッターをテーマの地の内側へ
 *                    置くため、`main` もフッターもページ側の器（`PublicThemeShell`）が持つ。
 *                    `/invite/[code]` だけは共通ヘッダーを残す。
 * - `/organizer/events/:id/preview` … 下書きプレビュー。ヘッダー直下に編集バーを置くため、
 *                    上端の余白を落とす。ヘッダーとフッターは出す。
 * - それ以外       … 公開ヘッダーとフッターを出す。
 *
 * 判定を `SiteChrome` の中に置くと、増えたときに分岐が散る。ここ 1 か所に集める。
 */
export interface SiteChromeState {
  /** 共通ヘッダー（`Navbar`）を出すか。 */
  readonly header: boolean;
  /** フッターを出すか。 */
  readonly footer: boolean;
  /**
   * `<main>` を `SiteChrome` が描くか。
   *
   * テーマ付きの公開ページは、フッターをテーマの地の内側へ置くため、ページ側の
   * 器（`PublicThemeShell`）が `main` とフッターを持つ。ここが false のとき
   * `SiteChrome` は `main` もフッターも描かず、children だけを返す。
   */
  readonly main: boolean;
  /** `main` の上端の余白を落とすか。ヘッダーのない LP と、ヘッダー直下に全幅帯を置く画面。 */
  readonly flushTop: boolean;
}

/** 前方一致はパスの区切りまで見る。`/consolelike` を `/console` と誤認しないため。 */
function inConsole(pathname: string): boolean {
  return pathname === "/console" || pathname.startsWith("/console/");
}

/**
 * `prefix` の直下、ちょうど 1 段の部分を返す。1 段でなければ null。
 *
 * 末尾のスラッシュは同じ段として扱う（`/events/abc/` は `/events/abc` と同じ）。
 * `/events/abc/edit` のような深いパスと、段の無い `/events/` は外れる。
 * 前方一致だけでは `/organizers` 一覧と `/organizers/[userId]` を分けられないため、
 * テーマ付きの公開ページはこの関数で 1 段（または 2 段）まで見る。
 */
function oneSegmentUnder(pathname: string, prefix: string): string | null {
  if (!pathname.startsWith(prefix)) return null;
  const rest = pathname.slice(prefix.length).replace(/\/$/, "");
  return rest.length > 0 && !rest.includes("/") ? rest : null;
}

/** 主催者の公開ページ。`/organizer`（主催者エリア）とは別のプレフィックス。 */
function inOrganizerPublic(pathname: string): boolean {
  return pathname === "/organizers" || pathname.startsWith("/organizers/");
}

/**
 * 公開の告知。`/organizer/events/` は `startsWith("/events/")` にならない。
 * ID なしの `/events` はホームへリダイレクトするが、接頭辞として同じ扱いにする。
 */
function inEventPublic(pathname: string): boolean {
  return pathname === "/events" || pathname.startsWith("/events/");
}

/** `/events/[id]` のみ。配下の画面は上端余白も `main` も残す。 */
function inEventAnnouncement(pathname: string): boolean {
  return oneSegmentUnder(pathname, "/events/") !== null;
}

/** `/organizers/[userId]` のみ。`/organizers` 一覧は共通ヘッダーを出さないだけの別扱い。 */
function inOrganizerProfile(pathname: string): boolean {
  return oneSegmentUnder(pathname, "/organizers/") !== null;
}

/** `/invite/[code]` のみ。コード無しの `/invite` は対象外。 */
function inInvite(pathname: string): boolean {
  return oneSegmentUnder(pathname, "/invite/") !== null;
}

/**
 * `/sample/profile/[slug]` のみ。slug 無しの `/sample/profile` は見本の一覧として扱う
 * （`/sample/[slug]` の slug と紛れるため、下の判定より先に見る）。
 */
function inSampleProfile(pathname: string): boolean {
  return oneSegmentUnder(pathname, "/sample/profile/") !== null;
}

/** `/sample/[slug]` のみ。`/sample` 一覧と、slug 無しの `/sample/profile` は対象外。 */
function inSampleEvent(pathname: string): boolean {
  const slug = oneSegmentUnder(pathname, "/sample/");
  return slug !== null && slug !== "profile";
}

/** 下書きプレビュー。`/organizer/events/preview` のような ID なしのパスは対象外。 */
function isEventPreview(pathname: string): boolean {
  return /^\/organizer\/events\/[^/]+\/preview\/?$/.test(pathname);
}

/** 告知ページの見本。`/samplelike` を `/sample` と誤認しないよう区切りまで見る。 */
function inSample(pathname: string): boolean {
  return pathname === "/sample" || pathname.startsWith("/sample/");
}

export function siteChrome(pathname: string): SiteChromeState {
  if (inConsole(pathname)) {
    return { header: false, footer: false, main: true, flushTop: false };
  }
  if (pathname === "/") {
    return { header: false, footer: true, main: true, flushTop: true };
  }
  // テーマ付きの公開ページは、フッターをテーマの地の内側へ置くため、
  // `main` とフッターをページ側の器（`PublicThemeShell`）へ渡す。
  if (inOrganizerProfile(pathname)) {
    return { header: false, footer: false, main: false, flushTop: false };
  }
  if (inInvite(pathname)) {
    // 招待は案内の入口なので、共通ヘッダーだけは残す。
    return { header: true, footer: false, main: false, flushTop: false };
  }
  if (inSampleProfile(pathname)) {
    return { header: false, footer: false, main: false, flushTop: true };
  }
  if (inSampleEvent(pathname)) {
    return { header: false, footer: false, main: false, flushTop: true };
  }
  if (inEventAnnouncement(pathname)) {
    return { header: false, footer: false, main: false, flushTop: true };
  }
  if (inOrganizerPublic(pathname)) {
    return { header: false, footer: true, main: true, flushTop: false };
  }
  if (inEventPublic(pathname)) {
    return { header: false, footer: true, main: true, flushTop: false };
  }
  if (inSample(pathname)) {
    return { header: false, footer: true, main: true, flushTop: true };
  }
  if (isEventPreview(pathname)) {
    return { header: true, footer: true, main: true, flushTop: true };
  }
  return { header: true, footer: true, main: true, flushTop: false };
}

/**
 * 主催者の節（`OrganizerTabs`）を出すか。パスだけから決める純関数。
 *
 * 主催者管理の入口画面（主催一覧・カレンダー・売上・下書き・プロフィール・マイページ・
 * 通知一覧）と、イベント単位の名簿・売上だけに出す。作成・編集・プレビュー・登録案内といった
 * 作業画面では本文に集中させるため出さない。判定を `SiteChrome` の中に置くと分岐が散るので、
 * `siteChrome` と同じくここ 1 か所に集める。
 */
export function showOrganizerTabs(pathname: string): boolean {
  switch (pathname) {
    case "/mypage":
    case "/notifications":
    case "/organizer/events":
    case "/organizer/events/drafts":
    case "/organizer/revenue":
    case "/organizer/calendar":
    case "/organizer/profile":
      return true;
    default:
      break;
  }
  // イベント単位の名簿・売上（`/organizer/events/[id]/participants` と `[id]/revenue`）。
  // 末尾で判定すると、編集・プレビューは自然に外れる。
  return (
    pathname.startsWith("/organizer/events/") &&
    (pathname.endsWith("/participants") || pathname.endsWith("/revenue"))
  );
}

/**
 * 参加者の節（`ParticipantTabs`）を出すか。パスだけから決める純関数。
 *
 * 参加者の画面（参加者ホーム・カレンダー・参加履歴）だけに出す。参加者ログイン
 * （`/participant/login`）は入口の画面なので、節を出さず本文に集中させる。
 */
export function showParticipantTabs(pathname: string): boolean {
  switch (pathname) {
    case "/participant":
    case "/participant/calendar":
    case "/participant/history":
      return true;
    default:
      return false;
  }
}
