import { prisma } from "@/lib/prisma";
import { generateSecureToken, sha256 } from "@/lib/crypto";
import { ProblemDetailException } from "@/lib/exceptions";
import { appBaseUrl } from "@/lib/http";
import { serializePricePlans, serializeSchedules } from "@/lib/serializers";
import { eventOptionsInclude } from "@/modules/events/lib/events";
import { organizerLabel } from "@/modules/organizers/lib/names";
import type { AuthContext } from "@/modules/auth/lib/guards";

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export async function createInvitation(eventId: string) {
  const event = await prisma.event.findFirst({
    where: { id: eventId, isDeleted: false },
    select: { id: true },
  });
  if (!event) {
    throw new ProblemDetailException({
      status: 404,
      title: "Not Found",
      detail: "イベントが見つかりません。",
    });
  }

  const inviteCode = generateSecureToken(24);
  const expiresAt = new Date(Date.now() + INVITE_TTL_MS);
  await prisma.eventInvitation.create({
    data: {
      eventId,
      inviteCodeHash: sha256(inviteCode),
      expiresAt,
    },
  });

  const inviteUrl = `/invitations/${inviteCode}`;
  return {
    inviteCode,
    inviteUrl,
    shareUrl: `${appBaseUrl()}${inviteUrl}`,
    expiresAt: expiresAt.toISOString(),
  };
}

async function findActiveInvitation(code: string) {
  const invitation = await prisma.eventInvitation.findUnique({
    where: { inviteCodeHash: sha256(code) },
    include: { event: { include: eventOptionsInclude } },
  });
  if (!invitation || invitation.isRevoked || invitation.expiresAt <= new Date() || invitation.event.isDeleted) {
    throw new ProblemDetailException({
      status: 404,
      title: "Not Found",
      detail: "招待コードが無効か、有効期限が切れています。",
    });
  }
  return invitation;
}

export async function previewInvitation(code: string) {
  const invitation = await findActiveInvitation(code);
  const [owner, coHostCount] = await Promise.all([
    prisma.eventOrganizer.findFirst({
      where: { eventId: invitation.eventId, role: "OWNER" },
      select: { displayName: true, user: { select: { name: true } } },
    }),
    prisma.eventOrganizer.count({
      where: { eventId: invitation.eventId, role: "CO_HOST" },
    }),
  ]);
  return {
    valid: true,
    invitation: { expiresAt: invitation.expiresAt.toISOString() },
    event: {
      id: invitation.event.id,
      title: invitation.event.title,
      schedules: serializeSchedules(invitation.event.schedules),
      pricePlans: serializePricePlans(invitation.event.pricePlans),
      location: invitation.event.location,
      rainPolicy: invitation.event.rainPolicy,
      organizer: {
        ownerName: owner ? organizerLabel({ role: "OWNER", ...owner }) : null,
        coHostCount,
      },
    },
  };
}

/**
 * 共同主催は会員だけが受諾できる。
 *
 * 未登録のまま共同主催になれると、名簿・領収書・売上を持たない権限だけの行が増え、
 * 「誰が主催者か」を公開ページに出せない。未登録の端末は会員登録へ送る。
 */
export async function acceptInvitation(code: string, identity: AuthContext) {
  if (!identity.userId) {
    throw new ProblemDetailException({
      status: 403,
      title: "Forbidden",
      type: "probs/register-required",
      detail: "共同主催への参加には会員登録が必要です。",
      error: "REGISTER_REQUIRED",
    });
  }
  const invitation = await findActiveInvitation(code);
  const userId = identity.userId;

  await prisma.$transaction(async (tx) => {
    // 既に幹事（OWNER を含む）なら何もしない。同時受諾で競合しても
    // @@unique([eventId, userId]) に任せて重複行を作らない。
    await tx.eventOrganizer.createMany({
      data: [{ eventId: invitation.eventId, userId, role: "CO_HOST" }],
      skipDuplicates: true,
    });

    await tx.eventInvitation.update({
      where: { id: invitation.id },
      data: { isRevoked: true },
    });
  });

  return {
    success: true,
    eventId: invitation.event.id,
    role: "CO_HOST" as const,
    manageUrl: `/organizer/events/${invitation.event.id}/edit`,
  };
}
