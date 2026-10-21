export type AuthMode = "register" | "login";

/**
 * 登録・ログイン画面の初期モード。
 * 公開直後の案内など、遷移元が `mode` を明示したときは `next` の有無より優先する。
 * 明示が無ければ、戻り先がある＝既存会員の再訪とみなしてログインから始める。
 */
export function resolveInitialAuthMode(mode: string | null, hasNext: boolean): AuthMode {
  if (mode === "register" || mode === "login") return mode;
  return hasNext ? "login" : "register";
}
