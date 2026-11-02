import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { sha256 } from "@/lib/crypto";
import { signLocalToken } from "@/modules/auth/lib/auth";
import { PUT as putCollection } from "@/app/api/v1/organizer/events/[id]/participants/[participantId]/collection/route";
import { cleanup, seedEvent, uniqueEmail } from "./helpers";

if (!process.env.JWT_SECRET) {
  process.env.JWT_SECRET = "integration-test-secret-key-0123456789";
}

const describeDb = process.env.TEST_DATABASE_URL ? describe : describe.skip;

function token(): string {
  return sha256(randomUUID());
}

/** 集金の切り替えを、名簿の 1 枚が送るのと同じ形（PUT + JSON）で叩く。 */
function collectionRequest(tokenValue: string, eventId: string, participantId: string, collected: boolean) {
  return new NextRequest(
    `http://localhost/api/v1/organizer/events/${eventId}/participants/${participantId}/collection`,
    {
      method: "PUT",
      headers: {
        cookie: `auth_token=${tokenValue}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ collected }),
    },
  );
}

describeDb("集金の記録（結合）", () => {
  const eventIds: string[] = [];
  const userIds: string[] = [];

  afterEach(async () => {
    await cleanup({ eventIds, userIds });
    eventIds.length = 0;
    userIds.length = 0;
  });

  async function createOrganizerEvent() {
    const organizer = await prisma.user.create({
      data: { email: uniqueEmail("collection"), name: "幹事" },
    });
    userIds.push(organizer.id);
    const event = await seedEvent({ userId: organizer.id, role: "OWNER" });
    eventIds.push(event.id);
    const authToken = await signLocalToken({ userId: organizer.id, email: organizer.email });
    return { organizer, event, authToken };
  }

  async function createParticipant(eventId: string, name: string, status: "ATTENDING" | "WAITLISTED" | "DECLINED") {
    return prisma.participant.create({
      data: { eventId, rsvpTokenHash: token(), name, status },
    });
  }

  it("集金済みにすると日時が入り、戻すと空になる", async () => {
    const { event, authToken } = await createOrganizerEvent();
    const participant = await createParticipant(event.id, "田中", "ATTENDING");

    const collected = await putCollection(
      collectionRequest(authToken, event.id, participant.id, true),
      { params: { id: event.id, participantId: participant.id } },
    );
    expect(collected.status).toBe(200);
    const body = (await collected.json()) as { participant: { id: string; collectedAt: string | null } };
    expect(body.participant.id).toBe(participant.id);
    expect(typeof body.participant.collectedAt).toBe("string");

    const afterCollect = await prisma.participant.findUniqueOrThrow({ where: { id: participant.id } });
    expect(afterCollect.collectedAt).not.toBeNull();

    const reverted = await putCollection(
      collectionRequest(authToken, event.id, participant.id, false),
      { params: { id: event.id, participantId: participant.id } },
    );
    expect(reverted.status).toBe(200);
    const revertedBody = (await reverted.json()) as {
      participant: { id: string; collectedAt: string | null };
    };
    expect(revertedBody.participant.collectedAt).toBeNull();

    const afterRevert = await prisma.participant.findUniqueOrThrow({ where: { id: participant.id } });
    expect(afterRevert.collectedAt).toBeNull();
  });

  it("出席のままなら集金を切り替えても出欠と人数を変えない", async () => {
    const { event, authToken } = await createOrganizerEvent();
    const participant = await createParticipant(event.id, "佐藤", "ATTENDING");
    await prisma.participant.update({
      where: { id: participant.id },
      data: { partySize: 3 },
    });

    const response = await putCollection(
      collectionRequest(authToken, event.id, participant.id, true),
      { params: { id: event.id, participantId: participant.id } },
    );
    expect(response.status).toBe(200);

    const after = await prisma.participant.findUniqueOrThrow({ where: { id: participant.id } });
    expect(after.status).toBe("ATTENDING");
    expect(after.partySize).toBe(3);
    expect(after.collectedAt).not.toBeNull();
  });

  it.each([
    ["WAITLISTED", "参加要望"],
    ["DECLINED", "欠席"],
  ] as const)("出席以外（%s）は集金を記録せず 400 にする", async (status, label) => {
    const { event, authToken } = await createOrganizerEvent();
    const participant = await createParticipant(event.id, `${label}さん`, status);

    const response = await putCollection(
      collectionRequest(authToken, event.id, participant.id, true),
      { params: { id: event.id, participantId: participant.id } },
    );
    expect(response.status).toBe(400);

    const after = await prisma.participant.findUniqueOrThrow({ where: { id: participant.id } });
    expect(after.collectedAt).toBeNull();
  });

  it("他のイベントの参加者は 404 にする", async () => {
    const { event, authToken } = await createOrganizerEvent();
    const other = await seedEvent();
    eventIds.push(other.id);
    const participant = await createParticipant(other.id, "別イベント", "ATTENDING");

    const response = await putCollection(
      collectionRequest(authToken, event.id, participant.id, true),
      { params: { id: event.id, participantId: participant.id } },
    );
    expect(response.status).toBe(404);
  });
});
