import { appBaseUrl } from "@/lib/http";
import { safeNextPath } from "@/lib/next-path";

/**
 * 確認メールのリンク。
 *
 * 登録を始めた画面（`next`）を、確認 → 電話番号の確認まで引き回す。
 * `next` は `safeNextPath` を通し、許可していないパスは付けない
 * （メールのリンクを踏んだ人を、意図しない画面へ送らないため）。
 */
export function verificationUrl(
  token: string,
  audience: "ORGANIZER" | "PARTICIPANT",
  next?: string | null,
): string {
  const params = new URLSearchParams({ token });
  // 参加者だけ入口を持ち帰る。主催者は既定なので付けない。
  if (audience === "PARTICIPANT") params.set("audience", "participant");
  const nextPath = safeNextPath(next, "");
  if (nextPath) params.set("next", nextPath);
  return `${appBaseUrl()}/auth/verify?${params.toString()}`;
}

/** 既に登録済みの人へ送るログインの案内。戻り先があれば同じく引き回す。 */
export function alreadyRegisteredUrl(next?: string | null): string {
  const params = new URLSearchParams({ mode: "login" });
  const nextPath = safeNextPath(next, "");
  if (nextPath) params.set("next", nextPath);
  return `${appBaseUrl()}/auth/register?${params.toString()}`;
}
