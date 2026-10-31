/**
 * 共通ヘッダーの並びを、会員の状態とパスだけで決める純関数。
 *
 * `Navbar` の中に置くと、状態が増えたときに分岐が散る。クロムの出し分けを
 * `src/lib/site-chrome.ts` に集めているのと同じ理由で、ここ 1 か所に集める。
 * DOM と Next に依存しないので、`tests/unit/site-nav.test.ts` で仕様を固定できる。
 *
 * 状態は 4 通り。
 * - 未ログイン            … サービス紹介とログインの入口
 * - 参加者                … 参加者ホーム・カレンダー・履歴・アカウント
 * - 主催者（参加者画面）  … 参加者の機能＋主催者マイページ
 * - 主催者（主催者画面）  … 主催一覧・作成・マイページ＋参加者として見る
 *
 * バーの並びに加えて、頭文字の札を押して開くメニュー（`userMenuConfig`）も
 * ここが決める。主催者画面の節（`OrganizerTabs`）と重なる行き先は、節がある
 * あいだはメニューに出さない。
 *
 * 管理者（`platformRole === "ADMIN"`）は別の役割として、主催者・参加者の機能を
 * 並べずに管理コンソールだけを出す。主催者と参加者は同じ会員が画面で切り替える
 * ものなので、そこは今までどおり 1 本の切り替えリンクに留める。
 */
import { SITE } from "@/lib/site";
import { showOrganizerTabs } from "@/lib/site-chrome";

export interface Viewer {
  name: string;
  isOrganizer: boolean;
  /** 会員の属性。管理者は公開画面でも管理コンソールへの導線だけを持つ。 */
  platformRole: "MEMBER" | "ADMIN";
}

export interface NavLink {
  href: string;
  label: string;
}

/**
 * links はメニューに入るテキストリンク、primary はバーに常時出す主要な入口、
 * action は切り替えリンク。primary と action がそろうと、幅が足りない端末では
 * action だけをメニュー先頭へ退避させる。
 *
 * `アカウント` はここに入れない。誰として入っているかとログアウトをまとめた
 * 頭文字のメニュー（`Navbar`）が持つ。同じ行き先をナビにも置くと、現在地が 2 つになる。
 */
export interface NavConfig {
  links: readonly NavLink[];
  primary?: NavLink;
  action?: NavLink;
}

/** 主催者向けの画面。ここでは参加者の機能を並べず、切り替えリンク 1 本に留める。 */
const ORGANIZER_AREA_PREFIXES = ["/mypage", "/organizer", "/invitations", "/notifications"] as const;

/** 前方一致はパスの区切りまで見る。`/organizerlike` を `/organizer` と誤認しないため。 */
export function inOrganizerArea(pathname: string): boolean {
  return ORGANIZER_AREA_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

/** いまの画面で誰として使っているか。ヘッダーの札（チップ）と並びの両方がこれを見る。 */
export type ViewerRole = "participant" | "organizer" | "admin";

export function viewerRole(pathname: string, viewer: Viewer): ViewerRole {
  if (viewer.platformRole === "ADMIN") return "admin";
  if (!viewer.isOrganizer) return "participant";
  // 主催者でも、参加者画面を見ているあいだは参加者として並べる。
  return inOrganizerArea(pathname) ? "organizer" : "participant";
}

/** 札に出す 1 語。文言は `SITE` が持つ。 */
export function viewerRoleLabel(role: ViewerRole): string {
  return SITE.role[role];
}

/**
 * 頭文字の札に出す 1 文字。名前が空でも崩れないよう「?」に落とす。
 * 絵文字などを 2 つに割らないよう、コードポイント単位で切る。
 */
export function viewerInitial(name: string): string {
  const [first] = Array.from(name.trim());
  return first ?? "?";
}

function participantConfig(viewer: Viewer): NavConfig {
  return {
    links: [
      SITE.nav.participantHome,
      SITE.nav.participantCalendar,
      SITE.nav.participantHistory,
      ...(viewer.isOrganizer ? [SITE.nav.mypage] : []),
    ],
    // 主催者としても使える人には切り替えを出さない。行き来は主催者画面側の 1 本だけ。
    action: viewer.isOrganizer ? undefined : SITE.nav.organizerSwitch,
  };
}

/**
 * 主催者画面。行き先はヘッダー直下の節（`OrganizerTabs`）がすべて持つので、
 * バーのナビには何も並べない。バーに残すのは「作る」と頭文字の札だけにして、
 * 現在地は節の 1 か所だけが示す。
 */
function organizerConfig(): NavConfig {
  return {
    links: [],
    primary: SITE.nav.createEvent,
    action: SITE.nav.participantSwitch,
  };
}

/** 管理者。公開画面からは辿れない管理コンソールへの 1 本だけを出す。 */
function adminConfig(): NavConfig {
  return { links: [SITE.nav.console] };
}

/**
 * アカウント設定。主催者・参加者のどちらの立場でも開く画面で、
 * 戻り先は本文が「主催者マイページへ／参加者ホームへ」として持つ。
 * バーのナビから同じ行き先を重ねない。
 */
function accountConfig(): NavConfig {
  return { links: [] };
}

/** 未ログイン。サービス紹介と、主催者・参加者それぞれの入口。 */
function anonymousConfig(): NavConfig {
  return {
    links: [SITE.nav.service, SITE.nav.participantLogin],
    primary: SITE.nav.createEvent,
    action: SITE.nav.organizerLogin,
  };
}

/**
 * 会員の状態とパスから、並べる機能を決める。
 * 主催者の機能と参加者の機能は同じ並びに混ぜない。
 */
export function siteNavConfig(pathname: string, viewer: Viewer | null): NavConfig {
  if (!viewer) return anonymousConfig();
  if (viewer.platformRole === "ADMIN") return adminConfig();
  if (pathname === SITE.nav.account.href) return accountConfig();
  return inOrganizerArea(pathname) ? organizerConfig() : participantConfig(viewer);
}

/**
 * 頭文字の札を押して開くメニューの中身。バーの並びと同じく、ここ 1 か所で決める。
 *
 * 主催者画面では節（`OrganizerTabs`）が行き先を持つので、同じ行き先を重ねない。
 * ただし節を出さない作業画面（作成・編集・プレビュー・領収書・招待）では
 * マイページへの入口が消えるため、そのときだけ「主催者マイページ」をここに残す。
 * 下書き（SCR-ORG-15）はイベントの一覧の一種で、節からは外してここが受ける。
 */
export function userMenuConfig(pathname: string, viewer: Viewer): NavLink[] {
  // 管理者は管理コンソールしか持たない。会員向けの行き先を出さない。
  if (viewer.platformRole === "ADMIN") return [];
  const links: NavLink[] = [];
  if (viewerRole(pathname, viewer) === "organizer") {
    links.push(SITE.nav.participantSwitch);
    if (!showOrganizerTabs(pathname)) links.push(SITE.nav.mypage);
    links.push(SITE.nav.notifications);
    links.push(SITE.nav.organizerDrafts);
  } else if (viewer.isOrganizer) {
    // 通知は主催者にしか作られない。参加者の端末には出さない。
    links.push(SITE.nav.notifications);
  }
  links.push(SITE.nav.account);
  return links;
}
