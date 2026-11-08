import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { sha256 } from "@/lib/crypto";
import { signLocalToken } from "@/modules/auth/lib/auth";
import { POST as postParticipant } from "@/app/api/v1/organizer/events/[id]/participants/route";
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

interface ParticipantBody {
  participant: {
    id: string;
    status: "ATTENDING" | "DECLINED" | "WAITLISTED";
    partySize: number;
    scheduleIds: string[];
    pricePlanId: string | null;
    pricePlanAmount: number | null;
    pricePlanLabel: string | null;
    payableAmount: number | null;
    waitlistedAt: string | null;
    waitlistPosition: number | null;
    deletedAt: string | null;
  };
}

function token(): string {
  return sha256(randomUUID());
}

/** 名簿の追加 POST を、画面が送るのと同じ形（Cookie + JSON）で叩く。 */
function createRequest(
  eventId: string,
  body: unknown,
  options: { authToken?: string; guestToken?: string } = {},
): NextRequest {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (options.authToken) headers.cookie = `auth_token=${options.authToken}`;
  // 未登録の幹事は Header のトークンで本人だけを名乗る（Cookie は使わない）。
  if (options.guestToken) headers["x-organizer-token"] = options.guestToken;
  return new NextRequest(`http://localhost/api/v1/organizer/events/${eventId}/participants`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

describeDb("主催者による参加者の追加（結合）", () => {
  const eventIds: string[] = [];
  const userIds: string[] = [];

  afterEach(async () => {
    await cleanup({ eventIds, userIds });
    eventIds.length = 0;
    userIds.length = 0;
  });

  async function createOrganizerEvent(
    options: {
      capacity?: number;
      status?: "DRAFT" | "PUBLISHED" | "CLOSED";
      /** 期限切れを試すときだけ入れる。 */
      rsvpDeadline?: Date;
      scheduleDates?: Date[];
    } = {},
  ) {
    const organizer = await prisma.user.create({
      data: { email: uniqueEmail("participant-create"), name: "幹事" },
    });
    userIds.push(organizer.id);
    const event = await seedEvent({
      userId: organizer.id,
      status: options.status ?? "PUBLISHED",
      scheduleDates: options.scheduleDates ?? [SCHEDULE_DATE],
    });
    eventIds.push(event.id);
    if (options.capacity !== undefined || options.rsvpDeadline !== undefined) {
      await prisma.event.update({
        where: { id: event.id },
        data: {
          ...(options.capacity !== undefined ? { capacity: options.capacity } : {}),
          ...(options.rsvpDeadline !== undefined ? { rsvpDeadline: options.rsvpDeadline } : {}),
        },
      });
    }
    const authToken = await signLocalToken({ userId: organizer.id, email: organizer.email });
    return { organizer, event, authToken };
  }

  /** 出席に要る日時・料金プランと、任意の割引を 1 組ずつ置く。 */
  async function seedOptions(eventId: string) {
    const schedules = await prisma.eventSchedule.findMany({
      where: { eventId },
      orderBy: { sortOrder: "asc" },
    });
    const plan = await prisma.eventPricePlan.create({
      data: { eventId, name: "一般", audience: "ANY", amount: 3000, sortOrder: 0 },
    });
    const discount = await prisma.eventDiscount.create({
      data: { eventId, name: "友達と参加", amount: 500, note: "2人以上のとき", sortOrder: 0 },
    });
    return { schedules, plan, discount };
  }

  async function seedAttending(eventId: string, name: string, partySize: number) {
    return prisma.participant.create({
      data: { eventId, rsvpTokenHash: token(), name, status: "ATTENDING", partySize },
    });
  }

  it("出席で追加すると料金・日程・割引の写しが入り、201 を返す", async () => {
    const { event, authToken } = await createOrganizerEvent({
      scheduleDates: [SCHEDULE_DATE, new Date("2026-12-06T00:00:00.000Z")],
    });
    const { schedules, plan, discount } = await seedOptions(event.id);

    // 送信順は選んだ順で揺れる。返す並びはイベントの並び順にそろう。
    const response = await postParticipant(
      createRequest(
        event.id,
        {
          name: "田中",
          status: "ATTENDING",
          partySize: 2,
          scheduleIds: [schedules[1].id, schedules[0].id],
          pricePlanId: plan.id,
          discountIds: [discount.id],
        },
        { authToken },
      ),
      { params: { id: event.id } },
    );

    expect(response.status).toBe(201);
    const body = (await response.json()) as ParticipantBody;
    expect(body.participant.status).toBe("ATTENDING");
    expect(body.participant.partySize).toBe(2);
    expect(body.participant.scheduleIds).toEqual([schedules[0].id, schedules[1].id]);
    expect(body.participant.pricePlanId).toBe(plan.id);
    expect(body.participant.pricePlanAmount).toBe(3000);
    expect(body.participant.pricePlanLabel).toContain("一般");
    // 支払額は (3,000 - 500) × 2 人。
    expect(body.participant.payableAmount).toBe(5000);
    expect(body.participant.waitlistPosition).toBeNull();
    expect(body.participant.deletedAt).toBeNull();

    const created = await prisma.participant.findUniqueOrThrow({
      where: { id: body.participant.id },
    });
    // 幹事が入れた行は会員に紐づけない。
    expect(created.userId).toBeNull();
    // 照合に使わない使い捨てのトークンだけを持つ（端末の Cookie は発行しない）。
    expect(created.rsvpTokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(created.deletedAt).toBeNull();
    // 料金は申込時点の写しとして持つ。
    expect(created.priceAmount).toBe(3000);
    expect(created.pricePlanName).toBe("一般");
    expect(created.priceAudience).toBe("ANY");

    const linkedSchedules = await prisma.participantSchedule.findMany({
      where: { participantId: created.id },
    });
    expect(linkedSchedules.map((row) => row.scheduleId).sort()).toEqual(
      [schedules[0].id, schedules[1].id].sort(),
    );

    const snapshots = await prisma.participantDiscount.findMany({
      where: { participantId: created.id },
    });
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]).toMatchObject({
      discountId: discount.id,
      name: "友達と参加",
      amount: 500,
      note: "2人以上のとき",
    });
  });

  it("定員が埋まっていれば出席の追加は 409 CAPACITY_REACHED になり、行は増えない", async () => {
    const { event, authToken } = await createOrganizerEvent({ capacity: 2 });
    const { schedules, plan } = await seedOptions(event.id);
    await seedAttending(event.id, "先着", 2);

    const before = await prisma.participant.count({ where: { eventId: event.id } });
    const response = await postParticipant(
      createRequest(
        event.id,
        {
          name: "入れない人",
          status: "ATTENDING",
          partySize: 1,
          scheduleIds: [schedules[0].id],
          pricePlanId: plan.id,
        },
        { authToken },
      ),
      { params: { id: event.id } },
    );

    expect(response.status).toBe(409);
    const body = (await response.json()) as ProblemBody;
    expect(body.status).toBe(409);
    expect(body.error).toBe("CAPACITY_REACHED");
    // 断った行は作らない。
    expect(await prisma.participant.count({ where: { eventId: event.id } })).toBe(before);
  });

  it("満員でも参加要望なら追加でき、待ち順の最後に並ぶ", async () => {
    const { event, authToken } = await createOrganizerEvent({ capacity: 1 });
    await seedAttending(event.id, "先着", 1);
    await prisma.participant.create({
      data: {
        eventId: event.id,
        rsvpTokenHash: token(),
        name: "先の要望",
        status: "WAITLISTED",
        partySize: 1,
        waitlistedAt: new Date(Date.now() - 60_000),
      },
    });

    const response = await postParticipant(
      createRequest(
        event.id,
        // 参加要望は席を取らないので、人数を送っても 1 人として受ける。
        { name: "後の要望", status: "WAITLISTED", partySize: 3 },
        { authToken },
      ),
      { params: { id: event.id } },
    );

    expect(response.status).toBe(201);
    const body = (await response.json()) as ParticipantBody;
    expect(body.participant.status).toBe("WAITLISTED");
    expect(body.participant.partySize).toBe(1);
    expect(typeof body.participant.waitlistedAt).toBe("string");
    // 先に出た要望が 1 番なので、後から入れた行は 2 番。
    expect(body.participant.waitlistPosition).toBe(2);

    const created = await prisma.participant.findUniqueOrThrow({
      where: { id: body.participant.id },
    });
    expect(created.waitlistedAt).not.toBeNull();
    expect(created.partySize).toBe(1);
  });

  it("受付停止中のイベントでも参加者を追加できる", async () => {
    const { event, authToken } = await createOrganizerEvent({ status: "CLOSED" });
    const { schedules, plan } = await seedOptions(event.id);

    const response = await postParticipant(
      createRequest(
        event.id,
        {
          name: "電話予約",
          status: "ATTENDING",
          scheduleIds: [schedules[0].id],
          pricePlanId: plan.id,
        },
        { authToken },
      ),
      { params: { id: event.id } },
    );

    expect(response.status).toBe(201);
    expect(await prisma.participant.count({ where: { eventId: event.id } })).toBe(1);
  });

  it("申し込み期限を過ぎていても参加者を追加できる", async () => {
    const { event, authToken } = await createOrganizerEvent({
      rsvpDeadline: new Date("2020-01-01T00:00:00.000Z"),
    });
    const { schedules, plan } = await seedOptions(event.id);

    const response = await postParticipant(
      createRequest(
        event.id,
        {
          name: "当日の飛び込み",
          status: "ATTENDING",
          scheduleIds: [schedules[0].id],
          pricePlanId: plan.id,
        },
        { authToken },
      ),
      { params: { id: event.id } },
    );

    expect(response.status).toBe(201);
    expect(await prisma.participant.count({ where: { eventId: event.id } })).toBe(1);
  });

  it("未登録のゲスト幹事は追加できず 403 REGISTER_REQUIRED になる", async () => {
    const guestToken = "guest-organizer-token";
    const event = await seedEvent({ guestTokenHash: sha256(guestToken) });
    eventIds.push(event.id);

    const response = await postParticipant(
      createRequest(event.id, { name: "ゲスト", status: "DECLINED" }, { guestToken }),
      { params: { id: event.id } },
    );

    expect(response.status).toBe(403);
    const body = (await response.json()) as ProblemBody;
    expect(body.status).toBe(403);
    expect(body.error).toBe("REGISTER_REQUIRED");
    expect(await prisma.participant.count({ where: { eventId: event.id } })).toBe(0);
  });
});
