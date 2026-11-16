import { prisma } from "@/lib/prisma";
import { ProblemDetailException } from "@/lib/exceptions";
import {
  emptyStats,
  serializeOrganizerListItem,
  type ParticipantStats,
} from "@/lib/serializers";
import { eventOptionsInclude, flyerAssetSelect } from "@/modules/events/lib/events";
import type { OrganizerEvent } from "@/modules/events/types";
import { organizerLabel } from "@/modules/organizers/lib/names";
import { ACTIVE_PARTICIPANT_WHERE } from "@/modules/participants/lib/where";

/**
 * 主催イベント一覧の読み取り。
 *
 * 主催一覧（SCR-ORG-01）の API と画面（サーバーコンポーネント）が同じ 1 本を使う。
 * 画面はここで読んだ結果をそのまま初期データとして渡すので、ハイドレーション後に
 * 同じ一覧をもう一度取りに行かない。
 */

/** 一覧を引く人の身元。会員のセッションか、ゲスト幹事の Cookie のどちらかが要る。 */
export interface OrganizerEventsIdentity {
  userId: string | null;
  /** ゲスト幹事の `org_token_*` をハッシュにしたもの。 */
  guestTokenHashes: readonly string[];
}

export interface OrganizerEventsViewer {
  userId: string | null;
  name: string | null;
}

export interface OrganizerEventsPayload {
  /** 下書きも含む全件。並びは作った新しい順（API の契約を変えない）。 */
  events: OrganizerEvent[];
  viewer: OrganizerEventsViewer;
}

export async function loadOrganizerEvents(
  identity: OrganizerEventsIdentity,
): Promise<OrganizerEventsPayload> {
  const { userId, guestTokenHashes } = identity;
  if (!userId && guestTokenHashes.length === 0) {
    throw new ProblemDetailException({
      status: 401,
      title: "Unauthorized",
      detail: "主催イベントを表示するにはログインするか、幹事トークンが必要です。",
    });
  }

  const organizers = await prisma.eventOrganizer.findMany({
    where: {
      event: { isDeleted: false },
      OR: [
        ...(userId ? [{ userId }] : []),
        ...(guestTokenHashes.length > 0 ? [{ guestTokenHash: { in: [...guestTokenHashes] } }] : []),
      ],
    },
    include: {
      event: {
        include: {
          // 一覧に出すチラシの列だけを引く（`lqipDataUrl` などは使わない）。
          flyerAsset: { select: flyerAssetSelect },
          ...eventOptionsInclude,
          organizers: {
            select: {
              id: true,
              role: true,
              userId: true,
              displayName: true,
              user: { select: { name: true } },
            },
          },
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  // 人数は参加者の行を運ばず、状態ごとの集計で数える。一覧のペイロードが
  // 参加者の件数に比例しなくなる（250 名の催しでも 3 行）。
  const eventIds = [...new Set(organizers.map((organizer) => organizer.eventId))];
  const grouped =
    eventIds.length > 0
      ? await prisma.participant.groupBy({
          by: ["eventId", "status"],
          // 一覧の人数は名簿に残っている行だけで数える。
          where: { eventId: { in: eventIds }, ...ACTIVE_PARTICIPANT_WHERE },
          _sum: { partySize: true },
          _count: { _all: true },
        })
      : [];
  const statsByEvent = new Map<string, ParticipantStats>();
  for (const row of grouped) {
    const stats = statsByEvent.get(row.eventId) ?? emptyStats();
    stats.totalResponses += row._count._all;
    if (row.status === "ATTENDING") stats.attendingCount += row._sum.partySize ?? 0;
    if (row.status === "DECLINED") stats.declinedCount += row._count._all;
    if (row.status === "WAITLISTED") stats.waitlistedCount += row._count._all;
    statsByEvent.set(row.eventId, stats);
  }

  const seen = new Set<string>();
  const events: OrganizerEvent[] = [];
  for (const organizer of organizers) {
    if (seen.has(organizer.eventId)) continue;
    seen.add(organizer.eventId);
    const owner = organizer.event.organizers.find((row) => row.role === "OWNER");
    events.push(
      serializeOrganizerListItem(
        organizer.event,
        organizer.role,
        statsByEvent.get(organizer.eventId) ?? emptyStats(),
        owner ? organizerLabel(owner) : "主催者",
        owner?.userId ?? null,
      ),
    );
  }

  // 自分の公開ページ（/organizers/[userId]）の導線に使う。ゲスト幹事は null。
  const viewer = userId
    ? await prisma.user.findUnique({ where: { id: userId }, select: { name: true } })
    : null;

  return { events, viewer: { userId, name: viewer?.name ?? null } };
}

/** 一覧から下書きを分ける。主催一覧は公開中と受付停止だけを並べる。 */
export function splitDraftEvents(events: readonly OrganizerEvent[]): {
  events: OrganizerEvent[];
  draftCount: number;
} {
  const visible = events.filter((event) => event.status !== "DRAFT");
  return { events: visible, draftCount: events.length - visible.length };
}
