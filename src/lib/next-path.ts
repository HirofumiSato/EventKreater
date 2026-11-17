/**
 * ログイン後の戻り先（`next`）の検証。
 *
 * Google の認可・確認メール・認証画面が同じ規則で通すので、1 か所に置く。
 * 画面からも読めるよう、DB や Next に依存させない。
 */

const NEXT_PREFIXES = ["/mypage", "/organizer", "/invitations", "/events", "/participant", "/organizers"];

/** ログイン後の戻り先として安全なパスだけを通す。不正なら fallback（入口ごとの既定）へ。 */
export function safeNextPath(value: string | null | undefined, fallback = "/mypage"): string {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.includes("\\") || value.includes("..")) {
    return fallback;
  }
  let decoded = value;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    return fallback;
  }
  if (!decoded.startsWith("/") || decoded.startsWith("//") || decoded.includes("\\") || decoded.includes("..")) {
    return fallback;
  }
  const path = decoded.split("?")[0]?.split("#")[0] ?? "";
  const allowed = NEXT_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
  return allowed ? decoded : fallback;
}
