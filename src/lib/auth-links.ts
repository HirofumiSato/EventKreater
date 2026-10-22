/**
 * 会員登録・ログインへの導線。戻り先を必ず持ち、登録や確認のあと元の画面へ帰す。
 * 画面ごとにクエリを直書きすると、`mode` や `next` の付け忘れが起きるため1か所に集める。
 */
export type AuthMode = "register" | "login";

export function registerUrl(next: string, mode: AuthMode = "register"): string {
  return `/auth/register?mode=${mode}&next=${encodeURIComponent(next)}`;
}

export function loginUrl(next: string): string {
  return registerUrl(next, "login");
}

/** 電話番号の確認へ進む URL。確認後は `next` へ戻る。 */
export function phoneVerifyUrl(next: string): string {
  return `/auth/register?step=phone&next=${encodeURIComponent(next)}`;
}
