import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { generateSecureToken, sha256 } from "@/lib/crypto";
import { normalizePostalCode } from "@/lib/postal-code";
import { composeLocation } from "@/lib/serializers";
import { resolveOptionalUserId } from "@/modules/auth/lib/guards";
import {
  VENUE_OWNER_COOKIE,
  VENUE_OWNER_MAX_AGE,
  writeCookie,
} from "@/modules/auth/lib/cookies";

/**
 * 過去に入力した会場の候補。
 *
 * 候補を出す範囲は「ログイン中の自分のイベント」と「この端末で作ったイベント」。
 * 会員は `u:<userId>`、未登録の幹事は `d:<端末トークンのsha256>` を ownerKey に持つ。
 * 端末トークンはサーバーが発行した Cookie からのみ導出し、本文やヘッダで
 * 他人の候補を指定できないようにする。
 */

/** 候補として覚える会場の入力値。イベント本体の住所列と同じ形。 */
export interface VenueAddressInput {
  venueName?: string | null;
  postalCode?: string | null;
  prefecture?: string | null;
  city?: string | null;
  town?: string | null;
  addressLine?: string | null;
  building?: string | null;
}

/** 一覧に返す候補。`location` は表示用に合成済み。 */
export interface VenueSuggestionView {
  id: string;
  venueName: string | null;
  postalCode: string | null;
  prefecture: string | null;
  city: string | null;
  town: string | null;
  addressLine: string | null;
  building: string | null;
  /** 会場名と住所を合成した表示用の文字列。 */
  location: string;
  lastUsedAt: string;
}

/** 一覧に出す候補の上限。 */
export const VENUE_SUGGESTION_LIMIT = 20;

/** 住所として覚える項目。空文字は null に寄せる。 */
const VENUE_FIELDS = [
  "venueName",
  "postalCode",
  "prefecture",
  "city",
  "town",
  "addressLine",
  "building",
] as const;

function trimOrNull(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed === "" ? null : trimmed;
}

/** 保存する形へ整える。郵便番号はハイフンを落として 7 桁に寄せる。 */
export function normalizeVenue(address: VenueAddressInput): VenueAddressInput {
  const postalCode = normalizePostalCode(address.postalCode ?? "");
  return {
    venueName: trimOrNull(address.venueName),
    postalCode: postalCode === "" ? null : postalCode,
    prefecture: trimOrNull(address.prefecture),
    city: trimOrNull(address.city),
    town: trimOrNull(address.town),
    addressLine: trimOrNull(address.addressLine),
    building: trimOrNull(address.building),
  };
}

/** 会場名か住所のどれか 1 つでも入っているか。 */
export function hasVenueAddress(address: VenueAddressInput): boolean {
  return VENUE_FIELDS.some((field) => trimOrNull(address[field]) !== null);
}

/**
 * 同じ会場かどうかを判定する指紋。
 * 空白の揺れと郵便番号のハイフンを吸収し、建物名まで含めて別会場と区別する。
 */
export function venueFingerprint(address: VenueAddressInput): string {
  const normalized = normalizeVenue(address);
  const parts = VENUE_FIELDS.map((field) => {
    const value = normalized[field] ?? "";
    return value.replace(/\s+/g, " ");
  });
  return sha256(parts.join("\u0000"));
}

/** 会員の候補。 */
export function venueOwnerKeyForUser(userId: string): string {
  return `u:${userId}`;
}

/** 未登録の幹事（この端末）の候補。トークンそのものは保存しない。 */
export function venueOwnerKeyForToken(rawToken: string): string {
  return `d:${sha256(rawToken)}`;
}

/**
 * 読み取りに使う ownerKey。ログイン中は自分の候補と、この端末の候補の両方を見る。
 * 端末の候補は、未登録のまま作ったイベントを会員登録後も引き続き選べるようにするため。
 * セッションが切れていても候補は開けるよう、未ログインとして端末の候補に寄せる。
 */
export async function venueOwnerKeys(req: NextRequest): Promise<string[]> {
  const userId = await resolveOptionalUserId(req);
  const rawToken = req.cookies.get(VENUE_OWNER_COOKIE)?.value;
  const keys: string[] = [];
  if (userId) keys.push(venueOwnerKeyForUser(userId));
  if (rawToken) keys.push(venueOwnerKeyForToken(rawToken));
  return keys;
}

/** 記録のときに払い出す Cookie。呼び出し側が応答に載せる。 */
export interface VenueOwnerCookie {
  rawToken: string;
  issueCookie: boolean;
}

/**
 * 入力された会場を候補として記録する。住所が空なら何もしない。
 *
 * 同じ会場は指紋で 1 行にまとめ、最後に使った日時だけを更新する。
 * 未登録の幹事には、この端末を識別する Cookie を新しく払い出す。
 */
export async function rememberVenue(
  req: NextRequest,
  address: VenueAddressInput,
): Promise<VenueOwnerCookie | null> {
  if (!hasVenueAddress(address)) return null;

  const userId = await resolveOptionalUserId(req);
  const existing = req.cookies.get(VENUE_OWNER_COOKIE)?.value;
  const rawToken = existing || generateSecureToken(32);

  const ownerKeys: string[] = [];
  if (userId) ownerKeys.push(venueOwnerKeyForUser(userId));
  // 未登録なら必ず端末の候補にする。会員でも Cookie が残っていれば端末の候補も更新する。
  if (!userId || existing) ownerKeys.push(venueOwnerKeyForToken(rawToken));

  const fingerprint = venueFingerprint(address);
  const data = normalizeVenue(address);
  await Promise.all(
    ownerKeys.map((ownerKey) =>
      prisma.venueSuggestion.upsert({
        where: { ownerKey_fingerprint: { ownerKey, fingerprint } },
        create: { ownerKey, fingerprint, ...data },
        update: { ...data, lastUsedAt: new Date() },
      }),
    ),
  );

  return { rawToken, issueCookie: !userId && !existing };
}

/**
 * 記録の失敗でイベントの作成・保存を止めない。候補は入力支援でしかないため。
 * 失敗はログだけに残し、呼び出し側はそのまま成功として返す。
 */
export async function rememberVenueQuietly(
  req: NextRequest,
  address: VenueAddressInput,
): Promise<VenueOwnerCookie | null> {
  try {
    return await rememberVenue(req, address);
  } catch (error) {
    console.error("[venue-suggestions] 会場を記録できませんでした", error);
    return null;
  }
}

/** 新しく払い出した端末トークンを応答の Cookie に載せる。 */
export function writeVenueOwnerCookie(
  response: NextResponse,
  req: NextRequest,
  cookie: VenueOwnerCookie | null,
): void {
  if (!cookie?.issueCookie) return;
  writeCookie(response, req, VENUE_OWNER_COOKIE, cookie.rawToken, VENUE_OWNER_MAX_AGE);
}

function toView(row: {
  id: string;
  venueName: string | null;
  postalCode: string | null;
  prefecture: string | null;
  city: string | null;
  town: string | null;
  addressLine: string | null;
  building: string | null;
  lastUsedAt: Date;
}): VenueSuggestionView {
  return {
    id: row.id,
    venueName: row.venueName,
    postalCode: row.postalCode,
    prefecture: row.prefecture,
    city: row.city,
    town: row.town,
    addressLine: row.addressLine,
    building: row.building,
    location: composeLocation(row),
    lastUsedAt: row.lastUsedAt.toISOString(),
  };
}

/**
 * 自分の候補を新しい順に返す。
 * 会員と端末の両方に同じ会場があれば、最後に使った日時が新しいほうだけを残す。
 */
export async function listVenueSuggestions(req: NextRequest): Promise<VenueSuggestionView[]> {
  const ownerKeys = await venueOwnerKeys(req);
  if (ownerKeys.length === 0) return [];

  const rows = await prisma.venueSuggestion.findMany({
    where: { ownerKey: { in: ownerKeys } },
    orderBy: { lastUsedAt: "desc" },
    take: VENUE_SUGGESTION_LIMIT * ownerKeys.length,
  });

  const seen = new Set<string>();
  const venues: VenueSuggestionView[] = [];
  for (const row of rows) {
    if (seen.has(row.fingerprint)) continue;
    seen.add(row.fingerprint);
    venues.push(toView(row));
  }
  return venues.slice(0, VENUE_SUGGESTION_LIMIT);
}

/**
 * 候補を削除する。自分の候補だけを消し、他人の候補は存在ごと伏せる。
 * 消せたときだけ true を返す（呼び出し側は 404 にする）。
 */
export async function deleteVenueSuggestion(req: NextRequest, id: string): Promise<boolean> {
  const ownerKeys = await venueOwnerKeys(req);
  if (ownerKeys.length === 0) return false;
  const result = await prisma.venueSuggestion.deleteMany({
    where: { id, ownerKey: { in: ownerKeys } },
  });
  return result.count > 0;
}
