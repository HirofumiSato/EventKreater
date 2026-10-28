/**
 * 郵便番号から住所を引く。郵便番号欄（手入力）と音声入力の両方が使う。
 *
 * 同じコードを何度も引かないよう、結果と実行中の問い合わせを 1 つにまとめる。
 * 音声で郵便番号を入れた直後に欄が同じコードで検索しても、通信は 1 回で済む。
 * 失敗は控えない（一時的な失敗のあと、もう一度押せば引き直せる）。
 */

import { normalizePostalCode } from "@/lib/postal-code";
import { readProblem } from "@/lib/problem";

/** 郵便番号検索の結果 1 件。 */
export interface PostalCodeResult {
  prefecture: string;
  city: string;
  town: string;
}

/** 控える件数。API 側のキャッシュ（1000 件）より小さく、画面の 1 操作ぶんだけ持つ。 */
const CACHE_LIMIT = 100;

const results = new Map<string, PostalCodeResult[]>();
const pending = new Map<string, Promise<PostalCodeResult[]>>();

/** テストの間で控えを持ち越さない。 */
export function resetPostalCodeSearch(): void {
  results.clear();
  pending.clear();
}

/**
 * 打ち終わった郵便番号か。
 *
 * 7 桁がそろい、前回の自動検索と同じコードでなければ true。
 * 同じコードで打ち直しても、自動検索を繰り返さない。
 */
export function shouldAutoSearchPostalCode(previousCode: string, nextValue: string): boolean {
  const code = normalizePostalCode(nextValue);
  return code.length === 7 && code !== previousCode;
}

/** 郵便番号から住所を引く。7 桁でなければ何もせず空を返す。 */
export async function lookupPostalCode(code: string): Promise<PostalCodeResult[]> {
  const normalized = normalizePostalCode(code);
  if (normalized.length !== 7) return [];

  const cached = results.get(normalized);
  if (cached) return cached;

  const running = pending.get(normalized);
  if (running) return running;

  const request = fetchResults(normalized);
  pending.set(normalized, request);
  try {
    const found = await request;
    writeCache(normalized, found);
    return found;
  } finally {
    pending.delete(normalized);
  }
}

async function fetchResults(code: string): Promise<PostalCodeResult[]> {
  const response = await fetch(`/api/v1/geo/postal-codes/${code}`);
  if (!response.ok) throw new Error(await readProblem(response));
  const body = (await response.json()) as { results?: PostalCodeResult[] };
  return body.results ?? [];
}

function writeCache(code: string, found: PostalCodeResult[]): void {
  if (results.size >= CACHE_LIMIT) {
    const oldest = results.keys().next().value;
    if (oldest) results.delete(oldest);
  }
  results.set(code, found);
}
