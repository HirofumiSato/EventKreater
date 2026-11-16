import { revalidateTag, unstable_cache } from "next/cache";
import { prisma } from "@/lib/prisma";
import { todayInTokyo } from "@/lib/calendar";
import {
  formatEventDate,
  isRsvpAccepting,
  serializeDiscounts,
  serializeFlyer,
  serializePricePlans,
  serializeSchedules,
} from "@/lib/serializers";
import { flyerAssetSelect } from "@/modules/events/lib/events";
import { isFull, remainingSeats } from "@/modules/events/lib/rsvp-status";
import type { PublicOrganizerEvent, PublicOrganizerPage } from "@/modules/events/types";
import { sortOrganizerEvents } from "@/modules/organizers/lib/public-page";
import { ACTIVE_PARTICIPANT_WHERE } from "@/modules/participants/lib/where";

/**
 * 主催者の公開ページ（`/organizers/[userId]`）の催し一覧。
 *
 * 画面（サーバーコンポーネント）と API（`/api/v1/public/organizers/[userId]/events`）が
 * 同じ 1 本を読む。画面は結果をそのまま初期データとして渡すので、ハイドレーション後に
 * 同じ一覧をもう一度取りに行かない。
 *
 * 2 層に分ける。告知ページ（`public-event.ts`）と同じ考え方である。
 *
 * - 掲載する催しの中身（題・日程・会場・チラシ）は誰が見ても同じ。`unstable_cache` に載せる。
 * - 人数は出欠のたびに動く。キャッシュへ入れると、参加のたびに全員のページを捨てることになる。
 *   ここでは毎回 1 本の集計で数える。
 *
 * 掲載条件（今日以降か、締め切っていないか）はキャッシュの外で判定する。日付と時刻で
 * 変わるものを 5 分固定すると、日付が変わった直後に古い一覧を返すためである。
 */

/** キャッシュの保持時間（秒）。書き込みで捨てるので、これは上限として使う。 */
const PUBLIC_ORGANIZER_REVALIDATE_SECONDS = 300;

/** キャッシュのタグ。読み取り（ここ）と書き込み（API ルート）で同じ文字列を使う。 */
export function publicOrganizerTag(userId: string): string {
  return `organizer:${userId}`;
}

/**
 * 主催者ページのキャッシュを捨てる。プロフィールの保存と、催しの公開状態が変わったときに呼ぶ。
 *
 * 告知ページと同じく、Next のリクエストの外（結合テストやスクリプト）では `revalidateTag` が
 * 投げる。タグが無いだけで書き込みは成立しているので、握って進む（上限の 5 分で追いつく）。
 */
export function revalidatePublicOrganizer(userId: string): void {
  try {
    revalidateTag(publicOrganizerTag(userId));
  } catch (error) {
    if (process.env.NODE_ENV !== "test") {
      console.error("主催者ページのキャッシュを捨てられませんでした", error);
    }
  }
}

/**
 * 催しの公開状態・内容が変わったときに、その催しを載せている主催者ページを捨てる。
 *
 * 共同主催のページもその催しを並べるので、筆頭幹事だけでなく会員の幹事を全員ぶん捨てる。
 * ゲスト幹事は公開ページを持たない（`userId` が無い）ため対象外。
 *
 * 後片付けなので、読めなくても書き込みは失敗させない。
 */
export async function revalidateOrganizerPagesOfEvent(eventId: string): Promise<void> {
  try {
    const rows = await prisma.eventOrganizer.findMany({
      where: { eventId, userId: { not: null } },
      select: { userId: true },
    });
    for (const userId of new Set(rows.map((row) => row.userId))) {
      if (userId) revalidatePublicOrganizer(userId);
    }
  } catch (error) {
    if (process.env.NODE_ENV !== "test") {
      console.error("主催者ページのキャッシュを捨てられませんでした", error);
    }
  }
}

/**
 * 誰が見ても同じ部分。人数と、期限で決まる `rsvpOpen` は持たない。
 * 期限は呼び出しのたびに判定できるよう、ISO 文字列のまま残す。
 */
interface PublicOrganizerEventBase
  extends Omit<
    PublicOrganizerEvent,
    "attendingCount" | "remainingSeats" | "isFull" | "acceptsWaitlist" | "rsvpOpen"
  > {
  rsvpDeadline: string | null;
}

interface PublicOrganizerBase {
  organizer: { userId: string; name: string };
  events: PublicOrganizerEventBase[];
}

/** 掲載候補を引く。**この関数の中では Cookie も時計も読まない。** */
async function queryPublicOrganizerBase(userId: string): Promise<PublicOrganizerBase | null> {
  const organizer = await prisma.user.findFirst({
    where: { id: userId, deletedAt: null },
    select: { id: true, name: true },
  });
  if (!organizer) return null;

  // 筆頭幹事と共同主催の両方のイベントを集める。誰でも読める入口なので、
  // 公開中で削除されていない催しだけを引く（下書き・受付停止は掲載条件でも弾かれる）。
  const rows = await prisma.eventOrganizer.findMany({
    where: { userId: organizer.id, event: { isDeleted: false, status: "PUBLISHED" } },
    select: {
      event: {
        select: {
          id: true,
          title: true,
          sortDate: true,
          location: true,
          capacity: true,
          status: true,
          rsvpDeadline: true,
          flyerAsset: { select: flyerAssetSelect },
          schedules: { orderBy: { sortOrder: "asc" } },
          pricePlans: { orderBy: { sortOrder: "asc" } },
          discounts: { orderBy: { sortOrder: "asc" } },
        },
      },
    },
  });

  return {
    organizer: { userId: organizer.id, name: organizer.name },
    events: rows.map(({ event }) => ({
      id: event.id,
      title: event.title,
      status: event.status,
      sortDate: formatEventDate(event.sortDate),
      schedules: serializeSchedules(event.schedules),
      pricePlans: serializePricePlans(event.pricePlans),
      discounts: serializeDiscounts(event.discounts),
      location: event.location,
      capacity: event.capacity,
      flyerAsset: serializeFlyer(event.flyerAsset),
      flyerThumbnailUrl: event.flyerAsset?.imageUrl ?? null,
      rsvpDeadline: event.rsvpDeadline ? event.rsvpDeadline.toISOString() : null,
    })),
  };
}

/**
 * 掲載候補のキャッシュ。タグは主催者ごとに分けるため、ID を含めて包み直す
 * （`unstable_cache` の `tags` は呼び出しごとの引数を取れない）。
 */
function loadPublicOrganizerBase(userId: string): Promise<PublicOrganizerBase | null> {
  const read = unstable_cache(() => queryPublicOrganizerBase(userId), ["public-organizer", userId], {
    revalidate: PUBLIC_ORGANIZER_REVALIDATE_SECONDS,
    tags: [publicOrganizerTag(userId)],
  });
  return read().catch((error: unknown) => {
    // Next のリクエストの外（結合テストやスクリプトがルート関数を直接呼ぶとき）には
    // データキャッシュが無く、`unstable_cache` が投げる。中身は同じなので素で引く。
    if (error instanceof Error && error.message.includes("incrementalCache missing")) {
      return queryPublicOrganizerBase(userId);
    }
    throw error;
  });
}

/** 出席の人数（`party_size` の合計）をイベントごとに数える。要望は含めない。 */
async function attendingCountsOf(eventIds: readonly string[]): Promise<Map<string, number>> {
  if (eventIds.length === 0) return new Map();
  const rows = await prisma.participant.groupBy({
    by: ["eventId"],
    where: { eventId: { in: [...eventIds] }, status: "ATTENDING", ...ACTIVE_PARTICIPANT_WHERE },
    _sum: { partySize: true },
  });
  return new Map(rows.map((row) => [row.eventId, row._sum.partySize ?? 0]));
}

/**
 * 公開ページ 1 枚ぶんの催し一覧。
 *
 * 掲載条件と人数はここで決める。会員が無い・退会済みなら null（呼び出し側が 404 にする）。
 * 催しが 0 件でも返す（初回公演の前にプロフィール URL を貼れるように）。
 */
export async function loadPublicOrganizerEvents(userId: string): Promise<PublicOrganizerPage | null> {
  const base = await loadPublicOrganizerBase(userId);
  if (!base) return null;

  const today = todayInTokyo();
  const now = new Date();
  const listed = sortOrganizerEvents(
    base.events.map((event) => ({
      ...event,
      isDeleted: false,
      rsvpOpen: isRsvpAccepting(
        {
          status: event.status,
          rsvpDeadline: event.rsvpDeadline ? new Date(event.rsvpDeadline) : null,
        },
        now,
      ),
    })),
    today,
  );

  const counts = await attendingCountsOf(listed.map((event) => event.id));
  const events: PublicOrganizerEvent[] = listed.map((event) => {
    const attendingCount = counts.get(event.id) ?? 0;
    const full = isFull(event.capacity, attendingCount);
    return {
      id: event.id,
      title: event.title,
      sortDate: event.sortDate,
      schedules: event.schedules,
      pricePlans: event.pricePlans,
      discounts: event.discounts,
      location: event.location,
      capacity: event.capacity,
      attendingCount,
      remainingSeats: remainingSeats(event.capacity, attendingCount),
      isFull: full,
      acceptsWaitlist: full && event.rsvpOpen,
      rsvpOpen: event.rsvpOpen,
      status: event.status,
      flyerAsset: event.flyerAsset,
      flyerThumbnailUrl: event.flyerThumbnailUrl,
    };
  });

  return { organizer: base.organizer, events };
}
