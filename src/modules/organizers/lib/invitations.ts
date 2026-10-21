import { prisma } from "@/lib/prisma";
import { generateSecureToken, sha256 } from "@/lib/crypto";
import { ProblemDetailException } from "@/lib/exceptions";
import { appBaseUrl } from "@/lib/http";
import { serializePricePlans, serializeSchedules } from "@/lib/serializers";
import { eventOptionsInclude } from "@/modules/events/lib/events";
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
    },
  };
}

export async function acceptInvitation(code: string, identity: AuthContext) {
  const invitation = await findActiveInvitation(code);
  const guestOrganizerToken = identity.userId ? null : generateSecureToken(32);

  await prisma.$transaction(async (tx) => {
    if (identity.userId) {
      const existing = await tx.eventOrganizer.findFirst({
        where: { eventId: invitation.eventId, userId: identity.userId },
      });
      if (!existing) {
        await tx.eventOrganizer.create({
          data: {
            eventId: invitation.eventId,
            userId: identity.userId,
            role: "CO_HOST",
          },
        });
      }
    } else if (guestOrganizerToken) {
      await tx.eventOrganizer.create({
        data: {
          eventId: invitation.eventId,
          guestTokenHash: sha256(guestOrganizerToken),
          role: "CO_HOST",
        },
      });
    }

    await tx.eventInvitation.update({
      where: { id: invitation.id },
      data: { isRevoked: true },
    });
  });

  return {
    success: true,
    eventId: invitation.event.id,
    role: "CO_HOST" as const,
    guestOrganizerToken,
    manageUrl: `/organizer/events/${invitation.event.id}/edit`,
  };
}
