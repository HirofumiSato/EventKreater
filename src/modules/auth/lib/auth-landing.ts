/**
 * ログイン済みのセッションで入口を開いたときの着地先。
 *
 * 画面（`AuthEntryScreen`）から純関数として切り離しておき、
 * 「戻り先の指定・電話番号の確認状況」の組み合わせだけをテストする。
 *
 * 会員の役割（`platformRole`）は見ない。管理者を管理コンソールへ送ると、
 * 公開の入口を押しただけで管理コンソールの在り処が分かってしまう。
 * 管理者は自分で `/console/login` を開く（公開画面からは辿れない）。
 */

export type AuthAudience = "organizer" | "participant";

export interface LandingInput {
  audience: AuthAudience;
  hasExplicitNext: boolean;
  /** `safeNextPath` を通した戻り先。 */
  nextPath: string;
}

export interface SessionDestinationInput extends LandingInput {
  basePath: string;
  phoneVerified: boolean;
}

/** 電話番号の確認画面。`next` は明示されたときだけ引き継ぐ。 */
export function phoneStepHref(basePath: string, hasExplicitNext: boolean, nextPath: string): string {
  return `${basePath}?step=phone${hasExplicitNext ? `&next=${encodeURIComponent(nextPath)}` : ""}`;
}

/**
 * 電話番号の確認が済んだ会員の着地先。
 *
 * いつでも戻り先（既定は入口ごとの `/mypage` / `/participant`）へ返す。
 * 役割で分けないのは、公開の入口から管理コンソールへの道を作らないためである。
 */
export function resolveAuthLanding(input: LandingInput): string {
  return input.nextPath;
}

/**
 * 既存セッションで入口を開いたときの移動先。
 * 電話番号が未確認なら、ログインは済んでいるので確認画面だけを出す。
 */
export function resolveSessionDestination(input: SessionDestinationInput): string {
  if (!input.phoneVerified) {
    return phoneStepHref(input.basePath, input.hasExplicitNext, input.nextPath);
  }
  return resolveAuthLanding(input);
}

/** 共用端末で別の会員として入り直すためのクエリ。付いていれば既存セッションで飛ばさない。 */
export function isSwitchingAccount(value: string | null): boolean {
  return value === "1";
}
