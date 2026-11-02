import type { NextRequest } from "next/server";

/**
 * 紹介リンクのコードを覚えておく Cookie。
 *
 * 登録の入口（`/auth/register?ref=...`）でクライアントが書き、確認のときにサーバーが読む。
 * この画面は httpOnly にできない（サーバー側で応答を返す前に書く場所が無い）ので、
 * 値は必ずサーバー側で引き当てる。存在しないコードと退会者は `resolveReferrer` が弾く。
 */
export const REFERRAL_COOKIE = "ref_code";

/** 30日。リンクを踏んでから登録までの間隔を吸収する。 */
export const REFERRAL_MAX_AGE = 60 * 60 * 24 * 30;

/** 紹介コードの長さ。`nanoid` の `customAlphabet` と同じ桁にそろえる。 */
export const REFERRAL_CODE_LENGTH = 8;

/** Cookie の値を、コードの形（英数）だけに削る。壊れた値は null。 */
export function readReferralCookie(req: NextRequest): string | null {
  const raw = req.cookies.get(REFERRAL_COOKIE)?.value ?? "";
  const code = raw.replace(/[^0-9A-Za-z]/g, "").slice(0, REFERRAL_CODE_LENGTH);
  return code.length === REFERRAL_CODE_LENGTH ? code : null;
}
