import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { ProblemDetailException } from "@/lib/exceptions";
import { assertRegisteredOrganizer } from "@/modules/auth/lib/guards";
import { appBaseUrl, toErrorResponse } from "@/lib/http";
import { deliverMail } from "@/lib/mail";
import { priceLabel, scheduleLabel, serializePricePlans, serializeSchedules } from "@/lib/serializers";
import { eventOptionsInclude } from "@/modules/events/lib/events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: { id: string };
}

interface ReminderSource {
  id: string;
  title: string;
  location: string;
  schedules: Parameters<typeof serializeSchedules>[0];
  pricePlans: Parameters<typeof serializePricePlans>[0];
}

function buildReminder(event: ReminderSource) {
  const origin = appBaseUrl();
  const subject = `${event.title} 出欠のお願い`.slice(0, 200);
  const body = [
    `${event.title} の出欠をお願いします。`,
    scheduleLabel(serializeSchedules(event.schedules)),
    priceLabel(serializePricePlans(event.pricePlans)),
    event.location,
    `出欠の回答: ${origin}/events/${event.id}`,
    `参加履歴: ${origin}/mypage`,
  ].join("\n");
  return { subject, body };
}

async function loadEvent(eventId: string) {
  const event = await prisma.event.findFirst({
    where: { id: eventId, isDeleted: false },
    include: {
      ...eventOptionsInclude,
      participants: {
        where: { userId: { not: null } },
        include: { user: { select: { email: true } } },
      },
    },
  });
  if (!event) {
    throw new ProblemDetailException({
      status: 404,
      title: "Not Found",
      detail: "イベントが見つかりません。",
    });
  }
  return event;
}

function memberEmails(event: Awaited<ReturnType<typeof loadEvent>>): string[] {
  return [
    ...new Set(
      event.participants
        .map((row) => row.user?.email)
        .filter((email): email is string => Boolean(email)),
    ),
  ];
}

/** 登録済みの参加者へ、出欠の変更をお願いする文面を返す。メール配送は別の口で行う。 */
export async function GET(req: NextRequest, { params }: RouteContext) {
  try {
    await assertRegisteredOrganizer(req, params.id);
    const event = await loadEvent(params.id);
    const emails = memberEmails(event);
    const guestCount = await prisma.participant.count({
      where: { eventId: event.id, userId: null },
    });
    const { subject, body } = buildReminder(event);
    return NextResponse.json({
      subject,
      body,
      recipientCount: emails.length,
      skippedGuests: guestCount,
    });
  } catch (error) {
    return toErrorResponse(error, `/api/v1/organizer/events/${params.id}/reminders`);
  }
}

export async function POST(req: NextRequest, { params }: RouteContext) {
  try {
    await assertRegisteredOrganizer(req, params.id);
    const event = await loadEvent(params.id);
    const emails = memberEmails(event);
    const guestCount = await prisma.participant.count({
      where: { eventId: event.id, userId: null },
    });

    const { subject, body } = buildReminder(event);

    let sent = 0;
    let recorded = 0;
    for (const email of emails) {
      const status = await deliverMail({ to: email, subject, body });
      if (status === "SENT") sent += 1;
      else recorded += 1;
      await prisma.reminderDelivery.create({
        data: {
          eventId: event.id,
          recipientEmail: email,
          subject,
          body,
          status,
        },
      });
    }

    return NextResponse.json({
      sent,
      recorded,
      skippedGuests: guestCount,
      subject,
      body,
    });
  } catch (error) {
    return toErrorResponse(error, `/api/v1/organizer/events/${params.id}/reminders`);
  }
}
