import { revalidateTag, unstable_cache } from "next/cache";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  serializeEvent,
  serializeParticipantDiscounts,
  serializePublicOrganizerList,
} from "@/lib/serializers";
import {
  eventOptionsInclude,
  flyerAssetSelect,
  sumAttendingHeadcount,
} from "@/modules/events/lib/events";
import { isFull, remainingSeats, waitlistPosition } from "@/modules/events/lib/rsvp-status";
import type { MyRsvp, PublicEvent } from "@/modules/events/types";
import { findMyParticipant, participantScheduleIds } from "@/modules/participants/lib/rsvp";
import { ACTIVE_PARTICIPANT_WHERE } from "@/modules/participants/lib/where";

/**
 * 告知ページ `/events/[id]` のデータ。
 *
 * 2 つに分けて持つ。混ぜると、どちらかが Cookie に依存した瞬間にキャッシュが
 * 閲覧者ごとに汚れる（`unstable_cache` は Cookie を見ない前提で共有される）。
 *
 * - `loadPublicEventStatic` … 誰が見ても同じ部分。`unstable_cache` に載せる。
 *   引数はイベント ID だけで、`cookies()` も `headers()` も読まない。
 * - `loadPublicEvent` … 上のキャッシュに、人数・自分の回答・閲覧者を足す。
 *   こちらはリクエストごとに引き直す。
 *
 * キャッシュは書き込みで捨てる（`revalidatePublicEvent`）。主催者の保存は
 * 直後に反映し、閲覧は数分古くても速さを優先する。
 */

/** 誰が見ても同じ部分。`PublicEvent` のうち、人数と閲覧者に関わる項目を除いたもの。 */
export type PublicEventStatic = Pick<
  PublicEvent,
  | "id"
  | "title"
  | "summary"
  | "sortDate"
  | "schedules"
  | "pricePlans"
  | "discounts"
  | "location"
  | "rainPolicy"
  | "capacity"
  | "targetGeneration"
  | "themeId"
  | "status"
  | "visibility"
  | "rsvpDeadline"
  | "rsvpOpen"
  | "organizers"
  | "flyerAsset"
>;

/** 人数・自分の回答・閲覧者。リクエストごとに引き直す部分。 */
type PublicEventLive = Pick<
  PublicEvent,
  | "attendingCount"
  | "waitlistCount"
  | "remainingSeats"
  | "isFull"
  | "acceptsWaitlist"
  | "loggedIn"
  | "viewer"
  | "myRsvp"
>;

/**
 * 読み取りの細かな違い。どれも「誰が見ても同じ」部分の作り方だけを変える。
 *
 * 告知ページ（`/events/[id]`）は既定のまま。公開 API は、以前から廃棄済みの
 * チラシも返していたので、外部契約を変えないために `includeDeletedFlyer` を立てる。
 * 返す項目（`PublicEvent`）はどちらも同じで、値が変わるのはこの 1 点だけ。
 */
export interface PublicEventLoadOptions {
  /** 廃棄したチラシも `flyerAsset` に入れるか。既定は false（告知ページの見た目に合わせる）。 */
  includeDeletedFlyer?: boolean;
}

/** 閲覧者を決めるための入力。Cookie を読むのは呼び出し側（`page.tsx`）の仕事。 */
export interface PublicEventViewerInput {
  /** 出欠 Cookie のハッシュ。端末が無ければ null。 */
  tokenHash: string | null;
  /** ログイン中の会員 ID。未ログインは null。 */
  userId: string | null;
  /** 端末のゲスト幹事 Cookie のハッシュ。勧誘カードの出し分けに使う。 */
  guestTokenHashes: string[];
}

/** キャッシュの保持時間（秒）。書き込みのたびに捨てるので、これは上限として使う。 */
const PUBLIC_EVENT_REVALIDATE_SECONDS = 300;

/**
 * ルートの `[id]` には何でも入る。UUID でなければ DB を引かずに「無い」として扱う
 * （Postgres は uuid 列の比較で型エラーになる）。
 */
const UUID_PATTERN = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

/** キャッシュのタグ。読み取り（ここ）と書き込み（API ルート）で同じ文字列を使う。 */
export function publicEventTag(eventId: string): string {
  return `event:${eventId}`;
}

/**
 * 告知ページの内容が変わりうる書き込みの後に呼ぶ。
 * 公開・停止・再開・削除・編集・下書き保存・出欠の送信から呼ぶ。
 *
 * 名簿（参加者の追加・編集・削除・復元）、共同主催（解除・招待の受諾）、
 * 端末からの引き継ぎ（`user/hydrate`）、退会（`user`）も、人数か主催者一覧が
 * 変わるので同じように呼ぶ。
 *
 * Next のリクエストの外（結合テストやスクリプトがルート関数を直接呼ぶとき）では
 * `revalidateTag` が投げる。タグが無いだけで書き込みは成立しているので、握って進む。
 * そのときも、キャッシュの上限（5 分）で自然に追いつく。
 */
export function revalidatePublicEvent(eventId: string): void {
  try {
    revalidateTag(publicEventTag(eventId));
  } catch (error) {
    if (process.env.NODE_ENV !== "test") {
      console.error("告知ページのキャッシュを捨てられませんでした", error);
    }
  }
}

/** 「自分の回答」に出す列。行をもう一度取り直さないため、ここで一度に引く。 */
const myParticipantSelect = {
  id: true,
  name: true,
  status: true,
  gender: true,
  comment: true,
  scheduleId: true,
  partySize: true,
  pricePlanId: true,
  discounts: { orderBy: { sortOrder: "asc" } },
  schedules: { select: { scheduleId: true, schedule: { select: { sortOrder: true } } } },
} satisfies Prisma.ParticipantSelect;

/**
 * 誰が見ても同じ部分を引く。**この関数の中では Cookie を読まない。**
 * 引数はイベント ID だけなので、キャッシュの鍵に閲覧者が混ざりようがない。
 */
async function queryPublicEventStatic(
  id: string,
  options: PublicEventLoadOptions,
): Promise<PublicEventStatic | null> {
  if (!UUID_PATTERN.test(id)) return null;
  const event = await prisma.event.findFirst({
    where: {
      id,
      isDeleted: false,
      status: { in: ["PUBLISHED", "CLOSED"] },
    },
    include: {
      // 廃棄したチラシは告知ページに出さない（OGP も同じ判断を使う）。
      flyerAsset: { select: { ...flyerAssetSelect, isDeleted: true } },
      ...eventOptionsInclude,
      organizers: {
        select: {
          id: true,
          role: true,
          userId: true,
          displayName: true,
          user: { select: { name: true } },
        },
        orderBy: { createdAt: "asc" },
      },
    },
  });
  if (!event) return null;

  const serialized = serializeEvent(event);
  const flyerAlive = event.flyerAsset !== null && !event.flyerAsset.isDeleted;
  return {
    id: serialized.id,
    title: serialized.title,
    summary: serialized.summary,
    sortDate: serialized.sortDate,
    schedules: serialized.schedules,
    pricePlans: serialized.pricePlans,
    discounts: serialized.discounts,
    location: serialized.location,
    rainPolicy: serialized.rainPolicy,
    capacity: serialized.capacity,
    targetGeneration: serialized.targetGeneration,
    themeId: serialized.themeId,
    status: serialized.status,
    visibility: serialized.visibility,
    rsvpDeadline: serialized.rsvpDeadline,
    rsvpOpen: serialized.rsvpOpen,
    organizers: serializePublicOrganizerList(event.organizers),
    // 廃棄済みは告知ページに出さない。公開 API だけは、以前の応答を変えないため
    // 明示されたときに限り返す（`PublicEventLoadOptions`）。
    flyerAsset: flyerAlive || options.includeDeletedFlyer ? serialized.flyerAsset : null,
  };
}

/**
 * 公開情報のキャッシュ。タグはイベントごとに分けるため、ID を含めて包み直す
 * （`unstable_cache` の `tags` は呼び出しごとの引数を取れない）。
 *
 * 告知ページと公開 API で「廃棄したチラシを出すか」だけが違うので、鍵にもその別を入れて
 * 2 本に分ける。タグは同じなので、書き込み 1 回でどちらも捨てられる。
 */
export function loadPublicEventStatic(
  id: string,
  options: PublicEventLoadOptions = {},
): Promise<PublicEventStatic | null> {
  const variant = options.includeDeletedFlyer ? "api" : "page";
  const read = unstable_cache(() => queryPublicEventStatic(id, options), ["public-event", id, variant], {
    revalidate: PUBLIC_EVENT_REVALIDATE_SECONDS,
    tags: [publicEventTag(id)],
  });
  return read().catch((error: unknown) => {
    // Next のリクエストの外（結合テストやスクリプトがルート関数を直接呼ぶとき）には
    // データキャッシュが無く、`unstable_cache` が投げる。中身は同じなので素で引く。
    if (error instanceof Error && error.message.includes("incrementalCache missing")) {
      return queryPublicEventStatic(id, options);
    }
    throw error;
  });
}

/** 人数・閲覧者・自分の回答を引く。イベント行に依存するので、静的部の後で 1 ウェーブにまとめる。 */
async function loadPublicEventLive(
  event: PublicEventStatic,
  viewer: PublicEventViewerInput,
): Promise<PublicEventLive> {
  const { userId, tokenHash, guestTokenHashes } = viewer;
  // このイベントの幹事かどうか。会員とゲスト幹事の端末の両方を見る。
  const organizerConditions = [
    ...(userId ? [{ userId }] : []),
    ...(guestTokenHashes.length > 0 ? [{ guestTokenHash: { in: guestTokenHashes } }] : []),
  ];

  const [
    attendingCount,
    waitlistCount,
    viewerName,
    myOrganizerRow,
    memberOrganizerCount,
    guestOwnerCount,
    found,
  ] = await Promise.all([
    sumAttendingHeadcount(prisma, event.id),
    // 待ち行列は件数だけ数える。行が要るのは、見ている本人が要望中のときだけ。
    prisma.participant.count({
      where: { eventId: event.id, status: "WAITLISTED", ...ACTIVE_PARTICIPANT_WHERE },
    }),
    // 誰として答えるかの 1 行に出す、ログイン中の会員名。
    userId
      ? prisma.user
          .findUnique({ where: { id: userId }, select: { name: true } })
          .then((row) => row?.name ?? null)
      : Promise.resolve(null),
    organizerConditions.length > 0
      ? prisma.eventOrganizer.findFirst({
          where: { eventId: event.id, OR: organizerConditions },
          select: { id: true },
        })
      : Promise.resolve(null),
    userId
      ? prisma.eventOrganizer.count({ where: { userId, event: { isDeleted: false } } })
      : Promise.resolve(0),
    // 未登録のまま自分のイベントを1件持つ幹事にも、勧誘カードは出さない。
    // 共同幹事だけの端末は「自分のイベント」を持っていないので、カードを出す。
    guestTokenHashes.length > 0
      ? prisma.eventOrganizer.count({
          where: {
            guestTokenHash: { in: guestTokenHashes },
            role: "OWNER",
            event: { isDeleted: false },
          },
        })
      : Promise.resolve(0),
    // 端末のクッキーが無い・別端末でも、ログインしていれば同じ回答を返す。
    findMyParticipant(prisma, { eventId: event.id, tokenHash, userId }, myParticipantSelect),
  ]);

  let myRsvp: MyRsvp | null = null;
  const participant = found?.participant ?? null;
  if (participant) {
    // 待ち順が要るのは要望中のときだけ。行はそのときに取り直す（人数は count で足りる）。
    const waitlistRows =
      participant.status === "WAITLISTED"
        ? await prisma.participant.findMany({
            // 名簿から外した要望は待ち順に数えない。
            where: { eventId: event.id, status: "WAITLISTED", ...ACTIVE_PARTICIPANT_WHERE },
            select: { id: true, status: true, waitlistedAt: true, createdAt: true },
            orderBy: [{ waitlistedAt: "asc" }, { createdAt: "asc" }, { id: "asc" }],
          })
        : [];
    myRsvp = {
      id: participant.id,
      name: participant.name,
      status: participant.status,
      gender: participant.gender,
      comment: participant.comment,
      scheduleId: participant.scheduleId,
      scheduleIds: participantScheduleIds(participant.schedules, participant.scheduleId),
      partySize: participant.partySize,
      pricePlanId: participant.pricePlanId,
      discounts: serializeParticipantDiscounts(participant.discounts),
      waitlistPosition: waitlistPosition(waitlistRows, participant.id),
    };
  }

  const seatsLeft = remainingSeats(event.capacity, attendingCount);
  const eventIsFull = isFull(event.capacity, attendingCount);
  return {
    attendingCount,
    waitlistCount,
    remainingSeats: seatsLeft,
    isFull: eventIsFull,
    // 満員でも、出欠を受け付けている間は参加要望を受け付ける。
    acceptsWaitlist: eventIsFull && event.rsvpOpen,
    loggedIn: Boolean(userId),
    viewer: {
      loggedIn: Boolean(userId),
      name: viewerName,
      isThisEventsOrganizer: Boolean(myOrganizerRow),
      hasOrganizerRole: memberOrganizerCount > 0 || guestOwnerCount > 0,
    },
    myRsvp,
  };
}

/**
 * 告知ページ 1 枚ぶんのデータ。
 *
 * 静的部はキャッシュから、人数・閲覧者・自分の回答はリクエストごとに引く。
 * 見つからない（下書き・削除済み・存在しない）ときは null を返し、404 の描き分けは
 * 呼び出し側に任せる。
 */
export async function loadPublicEvent(
  id: string,
  viewer: PublicEventViewerInput,
  options: PublicEventLoadOptions = {},
): Promise<PublicEvent | null> {
  const base = await loadPublicEventStatic(id, options);
  if (!base) return null;
  const live = await loadPublicEventLive(base, viewer);
  return { ...base, ...live };
}
