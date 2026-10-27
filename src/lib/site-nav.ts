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
 * 管理者（`platformRole === "ADMIN"`）は別の役割として、主催者・参加者の機能を
 * 並べずに管理コンソールだけを出す。主催者と参加者は同じ会員が画面で切り替える
 * ものなので、そこは今までどおり 1 本の切り替えリンクに留める。
 */
import { SITE } from "@/lib/site";

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
 */
export interface NavConfig {
  links: readonly NavLink[];
  primary?: NavLink;
  action?: NavLink;
}

/** 主催者向けの画面。ここでは参加者の機能を並べず、切り替えリンク 1 本に留める。 */
const ORGANIZER_AREA_PREFIXES = ["/mypage", "/organizer", "/invitations"] as const;

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
      SITE.nav.account,
      ...(viewer.isOrganizer ? [SITE.nav.mypage] : []),
    ],
    // 主催者としても使える人には切り替えを出さない。行き来は主催者画面側の 1 本だけ。
    action: viewer.isOrganizer ? undefined : SITE.nav.organizerSwitch,
  };
}

function organizerConfig(): NavConfig {
  return {
    links: [SITE.nav.organizerList, SITE.nav.mypage, SITE.nav.account],
    primary: SITE.nav.createEvent,
    action: SITE.nav.participantSwitch,
  };
}

/** 管理者。公開画面からは辿れない管理コンソールへの 1 本だけを出す。 */
function adminConfig(): NavConfig {
  return { links: [SITE.nav.console] };
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
  // アカウントは主催者・参加者のどちらからも開く。会員の属性で並びを決める。
  if (pathname === SITE.nav.account.href) {
    return viewer.isOrganizer ? organizerConfig() : participantConfig(viewer);
  }
  return inOrganizerArea(pathname) ? organizerConfig() : participantConfig(viewer);
}
