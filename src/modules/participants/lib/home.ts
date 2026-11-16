import { prisma } from "@/lib/prisma";
import {
  participationInclude,
  participationWhere,
  serializeParticipation,
  todayInTokyo,
} from "@/modules/participants/lib/participations";
import { ACTIVE_PARTICIPANT_WHERE } from "@/modules/participants/lib/where";
import type { ParticipationItem, ParticipationListResponse } from "@/modules/participants/types";

/**
 * 参加者ホーム（SCR-PUB-02）の読み取り。
 *
 * これまで画面が `/api/v1/user/profile` と `/api/v1/user/participations` を
 * ハイドレーション後に呼んでいた 2 本を、同じ 1 ウェーブにまとめる。
 * 数え方と並びは `participations` の API と同じ関数を使い、画面ごとに分けない。
 */

/** ホームに出す「これから」の件数。続きは参加履歴（/participant/history）が持つ。 */
const UPCOMING_LIMIT = 3;

export interface ParticipantHomeProfile {
  name: string;
  email: string;
}

export interface ParticipantHomePayload {
  profile: ParticipantHomeProfile;
  /** `/api/v1/user/participations?scope=upcoming&limit=3` と同じ形。 */
  upcoming: ParticipationListResponse;
}

/**
 * 会員の呼びかけ・要約・直近 3 件をまとめて読む。
 * 会員が見つからなければ null（呼び出し側がログインの案内を出す）。
 */
export async function loadParticipantHome(userId: string): Promise<ParticipantHomePayload | null> {
  const today = todayInTokyo();
  const upcomingWhere = participationWhere(userId, { scope: "upcoming" }, today);
  const [user, rows, total, attending, declined, waitlisted, upcomingCount, past] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { name: true, email: true } }),
    prisma.participant.findMany({
      where: upcomingWhere,
      include: participationInclude,
      // 日付の近い順。同じ日は回答の新しいものを先にする（履歴の API と同じ）。
      orderBy: [{ event: { sortDate: "asc" } }, { updatedAt: "desc" }],
      take: UPCOMING_LIMIT,
    }),
    prisma.participant.count({ where: upcomingWhere }),
    // 要約の 3 つも名簿から外した行を数えない（履歴の `where` と同じ条件）。
    prisma.participant.count({
      where: { userId, event: { isDeleted: false }, status: "ATTENDING", ...ACTIVE_PARTICIPANT_WHERE },
    }),
    prisma.participant.count({
      where: { userId, event: { isDeleted: false }, status: "DECLINED", ...ACTIVE_PARTICIPANT_WHERE },
    }),
    // 参加要望は参加人数にも欠席にも数えない。待ち順で承認されるまで別枠で持つ。
    prisma.participant.count({
      where: { userId, event: { isDeleted: false }, status: "WAITLISTED", ...ACTIVE_PARTICIPANT_WHERE },
    }),
    prisma.participant.count({ where: participationWhere(userId, { scope: "upcoming" }, today) }),
    prisma.participant.count({ where: participationWhere(userId, { scope: "past" }, today) }),
  ]);
  if (!user) return null;

  const items: ParticipationItem[] = rows.map(serializeParticipation);
  return {
    profile: user,
    upcoming: {
      items,
      page: 1,
      limit: UPCOMING_LIMIT,
      total,
      hasMore: items.length < total,
      summary: { attending, declined, waitlisted, upcoming: upcomingCount, past },
    },
  };
}
