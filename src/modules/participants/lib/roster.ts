import { prisma } from "@/lib/prisma";
import {
  serializePricePlans,
  serializeSchedules,
  summarizeStatuses,
} from "@/lib/serializers";
import type { EventPricePlanOption, EventScheduleOption, ParticipantRow } from "@/modules/events/types";
import { summarizeRevenue, type RevenueSummary } from "@/modules/revenue/lib/revenue";
import {
  participantRecordInclude,
  participantWaitlistSelect,
  serializeParticipantRow,
} from "@/modules/participants/lib/serialize";
import { ACTIVE_PARTICIPANT_WHERE } from "@/modules/participants/lib/where";

/**
 * 参加者名簿の読み取り。
 *
 * 名簿（SCR-ORG-06）の API と画面（サーバーコンポーネント）が同じ 1 本を使う。
 * 画面はここで読んだ結果をそのまま初期データに渡すので、見出しと集計帯が
 * 最初の HTML に載り、ハイドレーション後に名簿を取り直さない。
 */

/** 名簿の見出しに出す催しの情報。割引は名簿に出さないので持たない。 */
export interface RosterEventSummary {
  id: string;
  title: string;
  capacity: number | null;
  schedules: EventScheduleOption[];
  pricePlans: EventPricePlanOption[];
}

/** 集計帯の数値。削除済みの件数は絞り込みの札にだけ使う。 */
export interface RosterStats {
  attendingCount: number;
  declinedCount: number;
  waitlistedCount: number;
  totalResponses: number;
  deletedCount: number;
}

export interface RosterPayload {
  event: RosterEventSummary;
  stats: RosterStats;
  revenue: RevenueSummary;
  /** 未削除（作成順）→ 削除済み（削除した新しい順）。画面はこの順でそのまま並べる。 */
  participants: ParticipantRow[];
}

/**
 * 名簿を 1 回で読む。催しが無ければ null（API は 404、画面は案内を出す）。
 * 権限の確認は呼び出し側が持つ（API は `assertRegisteredOrganizer`）。
 */
export async function loadRoster(eventId: string): Promise<RosterPayload | null> {
  const event = await prisma.event.findFirst({
    where: { id: eventId, isDeleted: false },
    include: {
      // 名簿の見出しが使うのは日程と料金プランだけ。割引は名簿に出さないので引かない。
      schedules: { orderBy: { sortOrder: "asc" } },
      pricePlans: { orderBy: { sortOrder: "asc" } },
      // 削除済みも引く。名簿の末尾に薄く出して、元に戻せるようにするため。
      participants: { include: participantRecordInclude },
    },
  });
  if (!event) return null;

  // 集計・待ち順・売上は名簿に残っている行だけで数える。削除済みは末尾に並べるだけ。
  const active = event.participants
    .filter((row) => row.deletedAt === null)
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  const deleted = event.participants
    .filter((row) => row.deletedAt !== null)
    .sort((a, b) => (b.deletedAt?.getTime() ?? 0) - (a.deletedAt?.getTime() ?? 0));
  const waitlistRows = active.filter((row) => row.status === "WAITLISTED");

  return {
    event: {
      id: event.id,
      title: event.title,
      capacity: event.capacity,
      schedules: serializeSchedules(event.schedules),
      pricePlans: serializePricePlans(event.pricePlans),
    },
    // 削除済みの件数は絞り込みの札に使う。人数には数えない。
    stats: { ...summarizeStatuses(active), deletedCount: deleted.length },
    // 名簿を開いたついでに売上サマリも出す。内訳は /revenue で見る。
    revenue: summarizeRevenue(active),
    participants: [...active, ...deleted].map((row) => serializeParticipantRow(row, waitlistRows)),
  };
}

/** 名簿の画面が使う身元。会員のセッションと、ゲスト幹事の Cookie のハッシュ。 */
export interface RosterIdentity {
  userId: string | null;
  guestTokenHashes: readonly string[];
}

/**
 * 名簿の画面用。Cookie の身元から幹事権限を確かめ、名簿を読む。
 *
 * - 幹事でない: `forbidden`（API の 403「このイベントの幹事権限がありません。」と同じ）
 * - ゲスト幹事（会員でない）: `register-required`（会員登録の案内へ送る）
 * - 催しが無い・削除済み: `not-found`
 */
export type RosterPageResult =
  | { status: "ok"; data: RosterPayload }
  | { status: "forbidden" }
  | { status: "register-required" }
  | { status: "not-found" };

export async function loadRosterForPage(
  eventId: string,
  identity: RosterIdentity,
): Promise<RosterPageResult> {
  const { userId, guestTokenHashes } = identity;
  if (!userId && guestTokenHashes.length === 0) return { status: "forbidden" };

  const organizer = await prisma.eventOrganizer.findFirst({
    where: {
      eventId,
      OR: [
        ...(userId ? [{ userId }] : []),
        ...(guestTokenHashes.length > 0
          ? [{ guestTokenHash: { in: [...guestTokenHashes] } }]
          : []),
      ],
    },
    select: { id: true },
  });
  if (!organizer) return { status: "forbidden" };
  // ゲスト幹事は名簿を開けない（API と同じく会員登録の案内へ送る）。
  if (!userId) return { status: "register-required" };

  const data = await loadRoster(eventId);
  return data ? { status: "ok", data } : { status: "not-found" };
}
