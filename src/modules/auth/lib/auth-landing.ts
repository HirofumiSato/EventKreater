/**
 * ログイン済みのセッションで入口を開いたときの着地先。
 *
 * 画面（`AuthEntryScreen`）から純関数として切り離しておき、
 * 「戻り先の指定・役割・電話番号の確認状況」の組み合わせだけをテストする。
 */

export type AuthAudience = "organizer" | "participant";

/** 着地先の判定に要る会員の属性。`platformRole` は管理者の振り分けだけに使う。 */
export type LandingRole = "MEMBER" | "ADMIN";

export interface LandingInput {
  audience: AuthAudience;
  hasExplicitNext: boolean;
  /** `safeNextPath` を通した戻り先。 */
  nextPath: string;
  platformRole?: LandingRole;
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
 * 管理者を管理コンソールへ送るのは、主催者の入口で戻り先を指定されていないときだけ。
 * 参加者の入口や `next` 付きの遷移では、指定された画面へそのまま返す。
 */
export function resolveAuthLanding(input: LandingInput): string {
  const toConsole =
    input.audience === "organizer" && !input.hasExplicitNext && input.platformRole === "ADMIN";
  return toConsole ? "/console" : input.nextPath;
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
