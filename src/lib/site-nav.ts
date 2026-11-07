/**
 * 共通ヘッダーの並びを、会員の状態とパスだけで決める純関数。
 *
 * `Navbar` の中に置くと、状態が増えたときに分岐が散る。クロムの出し分けを
 * `src/lib/site-chrome.ts` に集めているのと同じ理由で、ここ 1 か所に集める。
 * DOM と Next に依存しないので、`tests/unit/site-nav.test.ts` で仕様を固定できる。
 *
 * 状態は 4 通り。
 * - 未ログイン            … サービス紹介とログインの入口
 * - 参加者                … ヘッダー直下の節（`ParticipantTabs`）が参加者の画面を持つ
 * - 主催者（参加者画面）  … 参加者と同じ。主催者としての入口は頭文字のメニューが持つ
 * - 主催者（主催者画面）  … 節（`OrganizerTabs`）が主催者の画面を持つ
 *
 * 参加者画面と主催者画面は、どちらもバーのナビを持たず、ヘッダー直下の節が
 * 移動を担う。バーに残るのはブランド・役割の札・頭文字の札だけになる。
 *
 * バーの並びに加えて、頭文字の札を押して開くメニュー（`userMenuConfig`）も
 * ここが決める。節（`OrganizerTabs` / `ParticipantTabs`）と重なる行き先は、
 * 節があるあいだはメニューに出さない。
 *
 * いまどちらの画面にいるかは、ヘッダーの地の色（`data-viewer-role`）と、
 * ブランド名の下に出す 1 語（`viewerRoleCaption`）の 2 つで示す。並びが
 * 変わっただけでは、参加者画面と主催者画面の違いに気づきにくいため。
 *
 * 管理者（`platformRole === "ADMIN"`）は別の役割として、主催者・参加者の機能を
 * 並べずに管理コンソールだけを出す。主催者と参加者は同じ会員が画面で切り替える
 * ものなので、そこは今までどおり 1 本の切り替えリンクに留める。
 */
import { SITE } from "@/lib/site";
import { showOrganizerTabs, siteChrome } from "@/lib/site-chrome";

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

/** 主催者と参加者が同じ画面を使う領域。立場は会員の属性（isOrganizer）で決める。 */
const SHARED_AREA_PREFIXES = ["/account"] as const;

/** 参加者向けの画面。 */
const PARTICIPANT_AREA_PREFIXES = ["/participant"] as const;

/** ヘッダーを出す公開画面。増やすときはここへ 1 行足す（勝手に増えないようテストで縛る）。 */
const PUBLIC_HEADER_PATHS = ["/service", "/terms", "/privacy", "/tokushoho"] as const;
const PUBLIC_HEADER_PREFIXES = ["/auth", "/invite"] as const;

/** 前方一致はパスの区切りまで見る。`/organizerlike` を `/organizer` と誤認しないため。 */
function inPrefixes(pathname: string, prefixes: readonly string[]): boolean {
  return prefixes.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

/** 主催者向けの画面か。 */
export function inOrganizerArea(pathname: string): boolean {
  return inPrefixes(pathname, ORGANIZER_AREA_PREFIXES);
}

/** いまの画面で誰として使っているか。ヘッダーの札（チップ）と並びの両方がこれを見る。 */
export type ViewerRole = "participant" | "organizer" | "admin";

/**
 * いまの画面がどの領域に属するか。ヘッダーの並び・札・メニューはすべてここを読む。
 *
 * 同じ知識を `viewerRole()` / `siteNavConfig()` / `userMenuConfig()` に散らすと、
 * `/account` のように複数の立場が使う画面で判定がずれる。領域の分類はここ 1 か所に置く。
 * - `admin`       … 管理コンソール（管理者だけの領域）
 * - `organizer`   … 主催者エリア
 * - `shared`      … 主催者と参加者が同じ画面を使う領域（`/account` 配下）
 * - `participant` … 参加者エリア
 * - `public`      … ヘッダーを出す公開画面
 * - `none`        … 共通ヘッダーを出さない画面
 * - `unclassified`… どの領域にも当てはまらない画面（分類漏れ。テストで検出する）
 */
export type ViewerArea =
  | "admin"
  | "organizer"
  | "shared"
  | "participant"
  | "public"
  | "none"
  | "unclassified";

/** パスだけから画面の領域を決める純関数。 */
export function viewerArea(pathname: string): ViewerArea {
  if (pathname === "/console" || pathname.startsWith("/console/")) return "admin";
  if (!siteChrome(pathname).header) return "none";
  if (inOrganizerArea(pathname)) return "organizer";
  if (inPrefixes(pathname, SHARED_AREA_PREFIXES)) return "shared";
  if (inPrefixes(pathname, PARTICIPANT_AREA_PREFIXES)) return "participant";
  if (PUBLIC_HEADER_PATHS.some((path) => path === pathname)) return "public";
  if (inPrefixes(pathname, PUBLIC_HEADER_PREFIXES)) return "public";
  return "unclassified";
}

/**
 * いまの画面で使っている立場。主催者エリアでは、まだ催しを持たない会員も
 * 主催者として扱う（登録直後は isOrganizer が false になるため）。
 * 参加者画面を見ているあいだは、主催イベントを持つ会員も参加者として並べる。
 * 共有画面（`/account` 配下）だけは、本文の戻り先と同じ材料（isOrganizer）で決める。
 */
export function viewerRole(pathname: string, viewer: Viewer): ViewerRole {
  if (viewer.platformRole === "ADMIN") return "admin";
  const area = viewerArea(pathname);
  if (area === "organizer") return "organizer";
  if (area === "shared") return viewer.isOrganizer ? "organizer" : "participant";
  // 参加者画面・公開画面・ヘッダーなしは参加者として示す（仕様 §2.4.1）。
  return "participant";
}

/** 札に出す 1 語。文言は `SITE` が持つ。 */
export function viewerRoleLabel(role: ViewerRole): string {
  return SITE.role[role];
}

/**
 * ヘッダーのブランド名の下に出す、いま使っているアカウントの種類。
 *
 * 参加者画面と主催者画面は同じヘッダーを使う。色（`data-viewer-role`）だけで
 * 分けると、色が見分けにくい人には伝わらない。同じ意味を文字でも置く。
 * 「〜の画面」は、いま何の画面かではなく、どの立場で入っているかを言う札にする。
 */
export function viewerRoleCaption(role: ViewerRole): string {
  return `${SITE.role[role]}アカウント`;
}

/**
 * 頭文字の札に出す 1 文字。名前が空でも崩れないよう「?」に落とす。
 * 絵文字などを 2 つに割らないよう、コードポイント単位で切る。
 */
export function viewerInitial(name: string): string {
  const [first] = Array.from(name.trim());
  return first ?? "?";
}

function participantConfig(): NavConfig {
  return {
    // 行き先はヘッダー直下の節（`ParticipantTabs`）がすべて持つ。バーのナビには何も並べない。
    links: [],
  };
}

/**
 * 主催者画面。行き先はヘッダー直下の節（`OrganizerTabs`）がすべて持つので、
 * バーのナビには何も並べない。バーに残すのはブランドと頭文字の札だけで、
 * 現在地は節の 1 か所だけが示す。
 *
 * 「作る」もバーには置かない。主催者が毎日見る画面の上端に常時あると、
 * 「主催一覧」「カレンダー」「売上」と同じ重さで並び、いまどこにいるのかが
 * 読みにくくなる。作る場所は画面の役割で決める。主催一覧（SCR-ORG-01）は
 * 下帯、マイページ（SCR-PUB-03）と売上（SCR-ORG-11）・カレンダー（SCR-ORG-13）
 * は本文が受ける。
 *
 * `action` は主催者エリアの戻り道として持つが、主催者エリアでは `viewerRole()` が
 * 常に `organizer` になるため `Navbar` は出さない（`organizerView`）。催し 0 件の
 * 会員も同じ扱いで、戻る道は頭文字のメニューの「参加者ログイン」が受ける。
 */
function organizerConfig(): NavConfig {
  return {
    links: [],
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

/**
 * アカウント設定の本文に出す戻り先。ヘッダーの立場（`viewerRole` の共有領域）と
 * 同じ材料（`isOrganizer`）から決める。片方だけ別の規則にすると、本文とヘッダーが
 * 食い違う（主催者なのに「参加者アカウント」と出る）ため、規則をそろえる。
 */
export function accountReturnTarget(isOrganizer: boolean): NavLink {
  return isOrganizer ? SITE.nav.mypage : SITE.nav.participantHome;
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
  const area = viewerArea(pathname);
  if (area === "shared") return accountConfig();
  return area === "organizer" ? organizerConfig() : participantConfig();
}

/**
 * 頭文字の札を押して開くメニューの中身。バーの並びと同じく、ここ 1 か所で決める。
 *
 * 参加者画面では節（`ParticipantTabs`）が参加者の画面を持つので、同じ行き先を重ねない。
 * 代わりに、主催者としても使える会員の入口（「主催者マイページ」。主催イベントを持たない
 * 会員には「主催者として使う」）をここが受ける。バーに置くと、390px ではブランド・
 * 役割の札・頭文字の札と並んで 1 段に収まらない。
 *
 * 主催者画面では節（`OrganizerTabs`）が行き先を持つので、同じ行き先を重ねない。
 * ただし節を出さない作業画面（作成・編集・プレビュー・招待）では
 * マイページへの入口が消えるため、そのときだけ「主催者マイページ」をここに残す。
 * 下書き（SCR-ORG-15）はイベントの一覧の一種で、節からは外してここが受ける。
 *
 * プランとカードの管理（SCR-ORG-17）は主催者だけの設定なので、主催者として見ている
 * あいだだけ「アカウント」の直前に置く（`/account` を主催者が開いたときも organizer に
 * なるため、そこで出るのが正しい）。参加者画面と管理者には出さない。
 */
export function userMenuConfig(pathname: string, viewer: Viewer): NavLink[] {
  // 管理者は管理コンソールしか持たない。会員向けの行き先を出さない。
  if (viewer.platformRole === "ADMIN") return [];
  const links: NavLink[] = [];
  if (inOrganizerArea(pathname)) {
    // 主催者エリアでは、まだ催しを持たない会員も主催者として扱う（viewerRole と同じ理由）。
    links.push(SITE.nav.participantSwitch);
    if (!showOrganizerTabs(pathname)) links.push(SITE.nav.mypage);
    // 通知は主催者にしか作られない。催し 0 件のあいだは端末にも出さない。
    if (viewer.isOrganizer) links.push(SITE.nav.notifications);
    links.push(SITE.nav.organizerDrafts);
  } else if (viewer.isOrganizer) {
    // 共有画面（/account 配下）もここに入る。参加者側の並びに主催者の行を足す現在の
    // 挙動が正解で、ヘッダーの立場（viewerRole）が organizer になることと一致する。
    // 主催者でもある会員の入口。参加者画面から主催者マイページへ戻る道はここだけになる。
    links.push(SITE.nav.mypage);
    // 通知は主催者にしか作られない。参加者の端末には出さない。
    links.push(SITE.nav.notifications);
  } else {
    // 主催イベントを持たない会員にも、主催者として使えることを 1 本だけ示す。
    links.push(SITE.nav.organizerSwitch);
  }
  // プラン画面は主催者だけの設定。参加者画面と管理者には出さない。
  // 主催者が `/account` を開いたときも organizer になるので、そこで出るのが正しい。
  if (viewerRole(pathname, viewer) === "organizer") links.push(SITE.nav.plan);
  links.push(SITE.nav.account);
  return links;
}
