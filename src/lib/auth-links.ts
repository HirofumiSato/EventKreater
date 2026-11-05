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

/**
 * パスワード再設定の入口。`token` を渡すとメールのリンク、渡さないと依頼の画面になる。
 * 画面のリンクとメール本文の両方で同じ組み立てを使う。
 */
export function passwordResetUrl(
  audience: "organizer" | "participant" = "organizer",
  token?: string,
): string {
  const params = new URLSearchParams();
  if (token) params.set("token", token);
  // 参加者だけ入口を持ち帰る。主催者は既定なので付けない。
  if (audience === "participant") params.set("audience", "participant");
  const query = params.toString();
  return query ? `/auth/password/reset?${query}` : "/auth/password/reset";
}

/** 再設定を終えたあとに戻るログインの入口。 */
export function loginEntryUrl(audience: "organizer" | "participant" = "organizer"): string {
  return audience === "participant" ? "/participant/login" : "/auth/register?mode=login";
}

