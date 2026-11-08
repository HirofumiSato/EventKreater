import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { sha256 } from "@/lib/crypto";
import { signLocalToken } from "@/modules/auth/lib/auth";
import { sumAttendingHeadcount } from "@/modules/events/lib/events";
import {
  DELETE as deleteParticipant,
  PATCH as patchParticipant,
} from "@/app/api/v1/organizer/events/[id]/participants/[participantId]/route";
import { POST as restoreParticipant } from "@/app/api/v1/organizer/events/[id]/participants/[participantId]/restore/route";
import { PUT as putCollection } from "@/app/api/v1/organizer/events/[id]/participants/[participantId]/collection/route";
import { GET as getRoster } from "@/app/api/v1/organizer/events/[id]/participants/route";
import { GET as getRevenue } from "@/app/api/v1/organizer/revenue/route";
import { POST as postRsvp } from "@/app/api/v1/public/events/[id]/rsvp/route";
import { cleanup, seedEvent, uniqueEmail } from "./helpers";

if (!process.env.JWT_SECRET) {
  process.env.JWT_SECRET = "integration-test-secret-key-0123456789";
}

const describeDb = process.env.TEST_DATABASE_URL ? describe : describe.skip;

const SCHEDULE_DATE = new Date("2026-12-05T00:00:00.000Z");

interface ProblemBody {
  status: number;
  error?: string;
  detail?: string;
}

interface DeleteBody {
  success: boolean;
  participant: { id: string; deletedAt: string | null };
}

interface RosterBody {
  stats: {
    attendingCount: number;
    declinedCount: number;
    waitlistedCount: number;
    totalResponses: number;
    deletedCount: number;
  };
  revenue: { expectedRevenue: number; collectedRevenue: number };
  participants: {
    id: string;
    status: "ATTENDING" | "DECLINED" | "WAITLISTED";
    waitlistPosition: number | null;
    deletedAt: string | null;
  }[];
}

interface RevenueBody {
  totals: { expectedRevenue: number; collectedRevenue: number };
}

function token(): string {
  return sha256(randomUUID());
}

function participantUrl(eventId: string, participantId: string): string {
  return `http://localhost/api/v1/organizer/events/${eventId}/participants/${participantId}`;
}

/** 名簿から外す DELETE。画面の「名簿から削除」と同じく Cookie だけで叩く。 */
function deleteRequest(authToken: string, eventId: string, participantId: string): NextRequest {
  return new NextRequest(participantUrl(eventId, participantId), {
    method: "DELETE",
    headers: { cookie: `auth_token=${authToken}` },
  });
}

/** 名簿の 1 枚からの PATCH。 */
function patchRequest(
  authToken: string,
  eventId: string,
  participantId: string,
  body: unknown,
): NextRequest {
  return new NextRequest(participantUrl(eventId, participantId), {
    method: "PATCH",
    headers: { cookie: `auth_token=${authToken}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

/** 削除済みを名簿へ戻す POST。 */
function restoreRequest(authToken: string, eventId: string, participantId: string): NextRequest {
  return new NextRequest(`${participantUrl(eventId, participantId)}/restore`, {
    method: "POST",
    headers: { cookie: `auth_token=${authToken}` },
  });
}

/** 集金の切り替え PUT。 */
function collectionRequest(
  authToken: string,
  eventId: string,
  participantId: string,
  collected: boolean,
): NextRequest {
  return new NextRequest(`${participantUrl(eventId, participantId)}/collection`, {
    method: "PUT",
    headers: { cookie: `auth_token=${authToken}`, "content-type": "application/json" },
    body: JSON.stringify({ collected }),
  });
}

function rosterRequest(authToken: string, eventId: string): NextRequest {
  return new NextRequest(`http://localhost/api/v1/organizer/events/${eventId}/participants`, {
    headers: { cookie: `auth_token=${authToken}` },
  });
}

function revenueRequest(authToken: string): NextRequest {
  return new NextRequest("http://localhost/api/v1/organizer/revenue", {
    headers: { cookie: `auth_token=${authToken}` },
  });
}

/** 参加者側の公開の出欠 POST。会員として送るので Cookie だけを渡す。 */
function rsvpRequest(eventId: string, authToken: string, body: unknown): NextRequest {
  return new NextRequest(`http://localhost/api/v1/public/events/${eventId}/rsvp`, {
    method: "POST",
    headers: {
      cookie: `auth_token=${authToken}`,
      "content-type": "application/json",
      "cf-connecting-ip": "203.0.113.61",
    },
    body: JSON.stringify(body),
  });
}

describeDb("名簿からの論理削除と復元（結合）", () => {
  const eventIds: string[] = [];
  const userIds: string[] = [];

  afterEach(async () => {
    // 出欠の POST が残した回数のバケットを消す。イベントを消しても行は残る。
    if (eventIds.length > 0) {
      await prisma.authAttempt.deleteMany({
        where: {
          OR: eventIds.map((eventId) => ({ bucket: { startsWith: `rsvp:ip:${eventId}:` } })),
        },
      });
    }
    await cleanup({ eventIds, userIds });
    eventIds.length = 0;
    userIds.length = 0;
  });

  async function createOrganizerEvent(
    options: { capacity?: number; scheduleDates?: Date[] } = {},
  ) {
    const organizer = await prisma.user.create({
      data: { email: uniqueEmail("soft-delete"), name: "幹事" },
    });
    userIds.push(organizer.id);
    const event = await seedEvent({
      userId: organizer.id,
      scheduleDates: options.scheduleDates ?? [],
    });
    eventIds.push(event.id);
    if (options.capacity !== undefined) {
      await prisma.event.update({ where: { id: event.id }, data: { capacity: options.capacity } });
    }
    const authToken = await signLocalToken({ userId: organizer.id, email: organizer.email });
    return { organizer, event, authToken };
  }

  async function createMember(name: string) {
    const member = await prisma.user.create({
      data: { email: uniqueEmail("soft-delete-member"), name },
    });
    userIds.push(member.id);
    return member;
  }

  interface SeedParticipantInput {
    name: string;
    status: "ATTENDING" | "DECLINED" | "WAITLISTED";
    userId?: string | null;
    partySize?: number;
    priceAmount?: number | null;
    collectedAt?: Date | null;
    waitlistedAt?: Date | null;
    rsvpTokenHash?: string;
  }

  async function seedParticipant(eventId: string, input: SeedParticipantInput) {
    const {
      name,
      status,
      userId = null,
      partySize = 1,
      priceAmount = null,
      collectedAt = null,
      waitlistedAt = null,
      rsvpTokenHash,
    } = input;
    return prisma.participant.create({
      data: {
        eventId,
        rsvpTokenHash: rsvpTokenHash ?? token(),
        name,
        status,
        partySize,
        userId,
        priceAmount,
        pricePlanName: priceAmount === null ? null : "一般",
        priceAudience: priceAmount === null ? null : "ANY",
        collectedAt,
        waitlistedAt: status === "WAITLISTED" ? (waitlistedAt ?? new Date()) : null,
      },
    });
  }

  it("削除すると行は残り、削除日時が入って会員の紐づけと出欠トークンが切り替わる", async () => {
    const { event, authToken } = await createOrganizerEvent();
    const member = await createMember("会員");
    const participant = await seedParticipant(event.id, {
      name: "田中",
      status: "ATTENDING",
      userId: member.id,
      rsvpTokenHash: "old-token-hash",
    });

    const response = await deleteParticipant(
      deleteRequest(authToken, event.id, participant.id),
      { params: { id: event.id, participantId: participant.id } },
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as DeleteBody;
    expect(body.success).toBe(true);
    expect(body.participant.id).toBe(participant.id);
    expect(typeof body.participant.deletedAt).toBe("string");

    const after = await prisma.participant.findUniqueOrThrow({ where: { id: participant.id } });
    // 行は消さない。名簿の末尾に残して元へ戻せるようにする。
    expect(after.deletedAt).not.toBeNull();
    // 一意制約と端末の照合から外すため、会員の紐づけと出欠トークンを切り替える。
    expect(after.userId).toBeNull();
    expect(after.rsvpTokenHash).not.toBe("old-token-hash");
    expect(after.rsvpTokenHash).toMatch(/^[0-9a-f]{64}$/);
    // 出欠そのものは変えない。
    expect(after.status).toBe("ATTENDING");
    expect(after.name).toBe("田中");
  });

  it("削除をもう一度送っても 200 を返し、削除日時は変えない", async () => {
    const { event, authToken } = await createOrganizerEvent();
    const participant = await seedParticipant(event.id, { name: "田中", status: "ATTENDING" });

    const first = await deleteParticipant(deleteRequest(authToken, event.id, participant.id), {
      params: { id: event.id, participantId: participant.id },
    });
    expect(first.status).toBe(200);
    const firstBody = (await first.json()) as DeleteBody;

    // 二重押しを 404 にしない。
    const second = await deleteParticipant(deleteRequest(authToken, event.id, participant.id), {
      params: { id: event.id, participantId: participant.id },
    });
    expect(second.status).toBe(200);
    const secondBody = (await second.json()) as DeleteBody;
    expect(secondBody.success).toBe(true);
    expect(secondBody.participant.deletedAt).toBe(firstBody.participant.deletedAt);

    // 行は 1 つのまま。押した回数だけ増えない。
    expect(await prisma.participant.count({ where: { eventId: event.id } })).toBe(1);
  });

  it("削除済みは出席人数・名簿の集計・売上に数えない", async () => {
    const { event, authToken } = await createOrganizerEvent();
    await seedParticipant(event.id, {
      name: "残る人",
      status: "ATTENDING",
      partySize: 2,
      priceAmount: 3000,
      collectedAt: new Date(),
    });
    const removed = await seedParticipant(event.id, {
      name: "外す人",
      status: "ATTENDING",
      partySize: 3,
      priceAmount: 5000,
      collectedAt: new Date(),
    });

    // 出席の人数は partySize の合計（2 + 3）。
    expect(await sumAttendingHeadcount(prisma, event.id)).toBe(5);

    const before = await getRoster(rosterRequest(authToken, event.id), {
      params: { id: event.id },
    });
    expect(before.status).toBe(200);
    const beforeBody = (await before.json()) as RosterBody;
    expect(beforeBody.stats.attendingCount).toBe(5);
    expect(beforeBody.stats.totalResponses).toBe(2);
    expect(beforeBody.stats.deletedCount).toBe(0);
    // (3,000 × 2 人) + (5,000 × 3 人)。
    expect(beforeBody.revenue.expectedRevenue).toBe(21000);
    expect(beforeBody.revenue.collectedRevenue).toBe(21000);

    expect(
      (
        await deleteParticipant(deleteRequest(authToken, event.id, removed.id), {
          params: { id: event.id, participantId: removed.id },
        })
      ).status,
    ).toBe(200);

    // 席を取っていないので定員の数え直しからも外れる。
    expect(await sumAttendingHeadcount(prisma, event.id)).toBe(2);

    const after = await getRoster(rosterRequest(authToken, event.id), {
      params: { id: event.id },
    });
    expect(after.status).toBe(200);
    const afterBody = (await after.json()) as RosterBody;
    expect(afterBody.stats.attendingCount).toBe(2);
    expect(afterBody.stats.totalResponses).toBe(1);
    expect(afterBody.stats.deletedCount).toBe(1);
    expect(afterBody.revenue.expectedRevenue).toBe(6000);
    // 集金済みのまま外しても、戻すまでは売上に入れない。
    expect(afterBody.revenue.collectedRevenue).toBe(6000);
  });

  it("削除済みの参加要望は待ち順から外れる", async () => {
    const { event, authToken } = await createOrganizerEvent();
    const first = await seedParticipant(event.id, {
      name: "先の要望",
      status: "WAITLISTED",
      waitlistedAt: new Date("2026-10-22T01:00:00.000Z"),
    });
    const second = await seedParticipant(event.id, {
      name: "後の要望",
      status: "WAITLISTED",
      waitlistedAt: new Date("2026-10-22T02:00:00.000Z"),
    });

    expect(
      (
        await deleteParticipant(deleteRequest(authToken, event.id, first.id), {
          params: { id: event.id, participantId: first.id },
        })
      ).status,
    ).toBe(200);

    const response = await getRoster(rosterRequest(authToken, event.id), {
      params: { id: event.id },
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as RosterBody;
    const byId = new Map(body.participants.map((row) => [row.id, row]));

    // 先に並んでいた人が抜けたので、後の人が 1 番になる。
    expect(byId.get(second.id)?.waitlistPosition).toBe(1);
    // 削除済みは要望として数えない。
    expect(byId.get(first.id)?.waitlistPosition).toBeNull();
    expect(body.stats.waitlistedCount).toBe(1);
  });

  it("名簿は削除済みを最後に返し、削除日時と削除件数を添える", async () => {
    const { event, authToken } = await createOrganizerEvent();
    const active = await seedParticipant(event.id, { name: "有効", status: "ATTENDING" });
    const removed = await seedParticipant(event.id, { name: "削除済み", status: "ATTENDING" });

    expect(
      (
        await deleteParticipant(deleteRequest(authToken, event.id, removed.id), {
          params: { id: event.id, participantId: removed.id },
        })
      ).status,
    ).toBe(200);

    const response = await getRoster(rosterRequest(authToken, event.id), {
      params: { id: event.id },
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as RosterBody;

    expect(body.participants.map((row) => row.id)).toEqual([active.id, removed.id]);
    expect(body.participants[0].deletedAt).toBeNull();
    expect(body.participants[1].deletedAt).not.toBeNull();
    expect(body.stats.deletedCount).toBe(1);
    expect(body.stats.totalResponses).toBe(1);
  });

  it("削除済みの参加者は編集できない（404）", async () => {
    const { event, authToken } = await createOrganizerEvent();
    const participant = await seedParticipant(event.id, { name: "田中", status: "ATTENDING" });

    expect(
      (
        await deleteParticipant(deleteRequest(authToken, event.id, participant.id), {
          params: { id: event.id, participantId: participant.id },
        })
      ).status,
    ).toBe(200);

    const response = await patchParticipant(
      patchRequest(authToken, event.id, participant.id, { name: "改名", status: "DECLINED" }),
      { params: { id: event.id, participantId: participant.id } },
    );

    expect(response.status).toBe(404);
    const body = (await response.json()) as ProblemBody;
    expect(body.status).toBe(404);
    expect(body.detail).toContain("削除済み");

    // 名簿に戻すまで中身は変えない。
    const after = await prisma.participant.findUniqueOrThrow({ where: { id: participant.id } });
    expect(after.name).toBe("田中");
    expect(after.status).toBe("ATTENDING");
  });

  it("削除済みの参加者には集金を記録できない（404）", async () => {
    const { event, authToken } = await createOrganizerEvent();
    const participant = await seedParticipant(event.id, {
      name: "田中",
      status: "ATTENDING",
      priceAmount: 3000,
    });

    expect(
      (
        await deleteParticipant(deleteRequest(authToken, event.id, participant.id), {
          params: { id: event.id, participantId: participant.id },
        })
      ).status,
    ).toBe(200);

    const response = await putCollection(
      collectionRequest(authToken, event.id, participant.id, true),
      { params: { id: event.id, participantId: participant.id } },
    );

    expect(response.status).toBe(404);
    const after = await prisma.participant.findUniqueOrThrow({ where: { id: participant.id } });
    expect(after.collectedAt).toBeNull();
  });

  it("横断の売上集計は削除済みを含めない", async () => {
    const { event, authToken } = await createOrganizerEvent();
    await seedParticipant(event.id, {
      name: "残る人",
      status: "ATTENDING",
      priceAmount: 4000,
      collectedAt: new Date(),
    });
    const removed = await seedParticipant(event.id, {
      name: "外す人",
      status: "ATTENDING",
      partySize: 2,
      priceAmount: 4000,
      collectedAt: new Date(),
    });

    const before = await getRevenue(revenueRequest(authToken));
    expect(before.status).toBe(200);
    const beforeBody = (await before.json()) as RevenueBody;
    // 4,000 円 + (4,000 円 × 2 人)。
    expect(beforeBody.totals.expectedRevenue).toBe(12000);

    expect(
      (
        await deleteParticipant(deleteRequest(authToken, event.id, removed.id), {
          params: { id: event.id, participantId: removed.id },
        })
      ).status,
    ).toBe(200);

    const after = await getRevenue(revenueRequest(authToken));
    expect(after.status).toBe(200);
    const afterBody = (await after.json()) as RevenueBody;
    expect(afterBody.totals.expectedRevenue).toBe(4000);
    expect(afterBody.totals.collectedRevenue).toBe(4000);
  });

  it("復元すると削除日時が消えて名簿に戻り、会員の紐づけは戻らない", async () => {
    const { event, authToken } = await createOrganizerEvent();
    const member = await createMember("会員");
    const participant = await seedParticipant(event.id, {
      name: "戻す人",
      status: "ATTENDING",
      userId: member.id,
      partySize: 2,
      priceAmount: 3000,
    });

    expect(
      (
        await deleteParticipant(deleteRequest(authToken, event.id, participant.id), {
          params: { id: event.id, participantId: participant.id },
        })
      ).status,
    ).toBe(200);
    expect(await sumAttendingHeadcount(prisma, event.id)).toBe(0);

    const response = await restoreParticipant(restoreRequest(authToken, event.id, participant.id), {
      params: { id: event.id, participantId: participant.id },
    });

    expect(response.status).toBe(200);
    const body = (await response.json()) as DeleteBody;
    expect(body.success).toBe(true);
    expect(body.participant.id).toBe(participant.id);
    expect(body.participant.deletedAt).toBeNull();

    const after = await prisma.participant.findUniqueOrThrow({ where: { id: participant.id } });
    expect(after.deletedAt).toBeNull();
    // 削除で切った会員との紐づけは戻さない。もう一度申し込めば別の行になる。
    expect(after.userId).toBeNull();
    expect(await sumAttendingHeadcount(prisma, event.id)).toBe(2);
  });

  it("削除されていない参加者の復元は 409 になる", async () => {
    const { event, authToken } = await createOrganizerEvent();
    const participant = await seedParticipant(event.id, { name: "有効", status: "ATTENDING" });

    const response = await restoreParticipant(restoreRequest(authToken, event.id, participant.id), {
      params: { id: event.id, participantId: participant.id },
    });

    expect(response.status).toBe(409);
    const body = (await response.json()) as ProblemBody;
    expect(body.status).toBe(409);
    expect(body.detail).toContain("削除されていません");
  });

  it("満員のイベントで出席を復元すると 409 CAPACITY_REACHED になる", async () => {
    const { event, authToken } = await createOrganizerEvent({ capacity: 2 });
    const participant = await seedParticipant(event.id, {
      name: "戻す人",
      status: "ATTENDING",
      partySize: 2,
    });

    expect(
      (
        await deleteParticipant(deleteRequest(authToken, event.id, participant.id), {
          params: { id: event.id, participantId: participant.id },
        })
      ).status,
    ).toBe(200);
    // 外した席に別の人が入り、定員が埋まる。
    await seedParticipant(event.id, { name: "先着", status: "ATTENDING", partySize: 2 });

    const response = await restoreParticipant(restoreRequest(authToken, event.id, participant.id), {
      params: { id: event.id, participantId: participant.id },
    });

    expect(response.status).toBe(409);
    const body = (await response.json()) as ProblemBody;
    expect(body.status).toBe(409);
    expect(body.error).toBe("CAPACITY_REACHED");

    // 戻せなかった行は削除済みのまま残す。
    const after = await prisma.participant.findUniqueOrThrow({ where: { id: participant.id } });
    expect(after.deletedAt).not.toBeNull();
  });

  it("削除された参加者は公開の出欠からもう一度申し込め、新しい行として名簿に戻る", async () => {
    const { event, authToken } = await createOrganizerEvent({ scheduleDates: [SCHEDULE_DATE] });
    const member = await createMember("申し込む会員");
    const memberToken = await signLocalToken({ userId: member.id, email: member.email });
    const plan = await prisma.eventPricePlan.create({
      data: { eventId: event.id, name: "一般", audience: "ANY", amount: 3000, sortOrder: 0 },
    });
    const schedule = await prisma.eventSchedule.findFirstOrThrow({
      where: { eventId: event.id },
      orderBy: { sortOrder: "asc" },
    });
    const original = await seedParticipant(event.id, {
      name: "田中",
      status: "ATTENDING",
      userId: member.id,
      priceAmount: 3000,
    });

    expect(
      (
        await deleteParticipant(deleteRequest(authToken, event.id, original.id), {
          params: { id: event.id, participantId: original.id },
        })
      ).status,
    ).toBe(200);

    const response = await postRsvp(
      rsvpRequest(event.id, memberToken, {
        name: "田中",
        status: "ATTENDING",
        scheduleIds: [schedule.id],
        pricePlanId: plan.id,
        partySize: 1,
      }),
      { params: { id: event.id } },
    );

    expect(response.status).toBe(201);
    const body = (await response.json()) as { success: boolean; myRsvp: { id: string } };
    expect(body.success).toBe(true);

    const rows = await prisma.participant.findMany({
      where: { eventId: event.id },
      orderBy: { createdAt: "asc" },
    });
    expect(rows).toHaveLength(2);

    // 消した行はそのまま残り、削除済みのまま。
    const deletedRow = rows.find((row) => row.id === original.id);
    expect(deletedRow?.deletedAt).not.toBeNull();

    // 会員の紐づけが切れているので、同じ人が新しい行として名簿に戻る。
    const created = rows.find((row) => row.id !== original.id);
    expect(created?.id).toBe(body.myRsvp.id);
    expect(created?.userId).toBe(member.id);
    expect(created?.deletedAt).toBeNull();
    expect(created?.status).toBe("ATTENDING");
  });
});
