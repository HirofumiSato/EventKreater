import { customAlphabet } from "nanoid";
import { REFERRAL_CODE_LENGTH } from "@/modules/auth/lib/referral-cookie";

/**
 * 紹介コードの形と、配るかどうかの判定。DB を持たない純ロジック。
 *
 * コードは 8 文字の英数。0/O と 1/l のように読み間違える文字を外し、
 * 口頭や手書きで伝えられても取り違えない形にする。
 */
export const REFERRAL_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

const generate = customAlphabet(REFERRAL_ALPHABET, REFERRAL_CODE_LENGTH);

/** 新しい紹介コードを1つ作る。重複の確認は呼び出し側（DB の UNIQUE）が行う。 */
export function generateReferralCode(): string {
  return generate();
}

/**
 * 紹介コードとして受け付けられる形か。Cookie や URL から来た値を、DB を引く前に落とす。
 * 形だけを見る（英数 8 文字）。生成で避けている文字も、DB に在れば引き当てる。
 */
export function isReferralCodeShape(value: string): boolean {
  return new RegExp(`^[0-9A-Za-z]{${REFERRAL_CODE_LENGTH}}$`).test(value);
}

/**
 * 自分で自分を紹介したか。紹介者が見つからない（`null`）ときは false。
 * 自作自演では券を配らない。
 */
export function isSelfReferral(referrerId: string | null, newUserId: string): boolean {
  return referrerId !== null && referrerId === newUserId;
}

/**
 * 1枚ぶんの冪等キー。同じ人が何度公開しても、同じ番号の券は1枚しか作られない。
 * `free_tickets.reason_key` の UNIQUE がこの形を前提にしている。
 */
export function referralReasonKey(newUserId: string, index: number): string {
  return `referral:${newUserId}:${index}`;
}

/** 紹介 URL。配るのは登録の入口だけなので、必ず `/auth/register` を指す。 */
export function referralUrl(baseUrl: string, code: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/auth/register?ref=${encodeURIComponent(code)}`;
}
