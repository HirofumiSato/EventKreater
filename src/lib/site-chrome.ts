/**
 * 公開クロム（ヘッダー・フッター）と上端の余白を、パスだけから決める純関数。
 *
 * - `/console`     … 管理コンソール。公開ヘッダーもフッターも出さない。
 * - `/`            … ホーム LP。初見の幹事にヒーローだけを見せるため、ヘッダーを出さず、
 *                    上端の余白も落とす。ログインの導線はヒーローとフッターが持つ。
 * - `/events/`     … 告知ページと領収書。共有されたイベントに集中させるため、共通ヘッダーは
 *                    出さない。フッターは残す。告知ページだけ上端の余白も落とし、チラシを
 *                    画面の上端から始める。`/organizer/events/` は主催者エリアなので対象外。
 * - `/sample`      … 告知ページの見本。本物の告知ページと同じ面に集中させるため、共通
 *                    ヘッダーは出さない。代わりに上端の帯（`SampleBand`）がクロムになる。
 *                    フッターは残し、上端の余白も落として帯を画面の上端から始める。
 * - `/organizers/` … 主催者の公開ページ。プロフィールとイベントに集中させるため、
 *                    共通ヘッダーは出さない。フッターは残す。
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
  /** `main` の上端の余白を落とすか。ヘッダーのない LP と、ヘッダー直下に全幅帯を置く画面。 */
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
  if (inSample(pathname)) {
    return { header: false, footer: true, flushTop: true };
  }
  if (isEventPreview(pathname)) {
    return { header: true, footer: true, flushTop: true };
  }
  return { header: true, footer: true, flushTop: false };
}

/**
 * 主催者の節（`OrganizerTabs`）を出すか。パスだけから決める純関数。
 *
 * 主催者管理の入口画面（主催一覧・カレンダー・売上・下書き・プロフィール・マイページ・
 * 通知一覧）と、イベント単位の名簿・売上だけに出す。作成・編集・プレビュー・領収書・登録案内といった
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
  // 末尾で判定すると、編集・プレビュー・領収書は自然に外れる。
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
