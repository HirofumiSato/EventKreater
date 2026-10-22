import { NextRequest, NextResponse } from "next/server";
import { ProblemDetailException } from "@/lib/exceptions";
import { toErrorResponse } from "@/lib/http";
import { normalizePostalCode } from "@/lib/postal-code";
import { clientIp } from "@/modules/auth/lib/cookies";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface PostalCodeResult {
  prefecture: string;
  city: string;
  town: string;
}

interface CacheEntry {
  expiresAt: number;
  results: PostalCodeResult[];
}

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const CACHE_LIMIT = 1000;
const RATE_LIMIT = 30;
const RATE_WINDOW_MS = 60 * 1000;

const cache = new Map<string, CacheEntry>();
const attempts = new Map<string, number[]>();

function upstreamBase(): string {
  return (process.env.POSTAL_CODE_API_URL || "https://zipcloud.ibsnet.co.jp/api/search").replace(
    /\/$/,
    "",
  );
}

function readCache(code: string): PostalCodeResult[] | null {
  const hit = cache.get(code);
  if (!hit) return null;
  if (hit.expiresAt <= Date.now()) {
    cache.delete(code);
    return null;
  }
  return hit.results;
}

function writeCache(code: string, results: PostalCodeResult[]): void {
  if (cache.size >= CACHE_LIMIT) {
    const oldest = cache.keys().next().value;
    if (oldest) cache.delete(oldest);
  }
  cache.set(code, { expiresAt: Date.now() + CACHE_TTL_MS, results });
}

/** 郵便番号の列挙を防ぐための、プロセス内の簡易レート制限。 */
function assertRateLimit(req: NextRequest): void {
  const key = clientIp(req) ?? "local";
  const now = Date.now();
  const recent = (attempts.get(key) ?? []).filter((at) => now - at < RATE_WINDOW_MS);
  if (recent.length >= RATE_LIMIT) {
    throw new ProblemDetailException({
      status: 429,
      title: "Too Many Requests",
      detail: "郵便番号の検索回数が多すぎます。少し待ってから再度お試しください。",
    });
  }
  recent.push(now);
  attempts.set(key, recent);
  if (attempts.size > CACHE_LIMIT) {
    const oldest = attempts.keys().next().value;
    if (oldest) attempts.delete(oldest);
  }
}

export async function GET(req: NextRequest, { params }: { params: { code: string } }) {
  const instance = `/api/v1/geo/postal-codes/${params.code}`;
  try {
    const code = normalizePostalCode(params.code);
    if (!/^\d{7}$/.test(code)) {
      throw new ProblemDetailException({
        status: 400,
        title: "Validation Error",
        detail: "郵便番号は7桁の数字で入力してください。",
      });
    }
    assertRateLimit(req);

    const cached = readCache(code);
    if (cached) {
      return NextResponse.json(
        { postalCode: code, results: cached },
        { headers: { "Cache-Control": "public, max-age=604800" } },
      );
    }

    let upstream: Response;
    try {
      upstream = await fetch(`${upstreamBase()}?zipcode=${code}`, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(5000),
        cache: "no-store",
      });
    } catch {
      throw new ProblemDetailException({
        status: 502,
        title: "Postal Code Unavailable",
        detail: "郵便番号検索サービスに接続できません。住所を手入力してください。",
      });
    }

    if (!upstream.ok) {
      throw new ProblemDetailException({
        status: 502,
        title: "Postal Code Unavailable",
        detail: "郵便番号検索サービスが応答しませんでした。住所を手入力してください。",
      });
    }

    const body = (await upstream.json().catch(() => null)) as {
      status?: number;
      results?: { address1?: string; address2?: string; address3?: string }[] | null;
    } | null;

    if (body?.status && body.status !== 200) {
      throw new ProblemDetailException({
        status: 502,
        title: "Postal Code Unavailable",
        detail: "郵便番号検索サービスが応答しませんでした。住所を手入力してください。",
      });
    }

    const results: PostalCodeResult[] = (body?.results ?? []).flatMap((row) => {
      if (!row.address1 || !row.address2) return [];
      return [
        {
          prefecture: row.address1,
          city: row.address2,
          town: row.address3 ?? "",
        },
      ];
    });

    if (results.length === 0) {
      throw new ProblemDetailException({
        status: 404,
        title: "Not Found",
        detail: "この郵便番号の住所が見つかりませんでした。番地から手入力してください。",
      });
    }

    writeCache(code, results);
    return NextResponse.json(
      { postalCode: code, results },
      { headers: { "Cache-Control": "public, max-age=604800" } },
    );
  } catch (error) {
    return toErrorResponse(error, instance);
  }
}
