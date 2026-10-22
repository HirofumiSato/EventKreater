import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ProblemDetailException } from "@/lib/exceptions";
import { assertCanCreateEvent } from "@/modules/billing/lib/quota";
import {
  audiencesForGender,
  composeEventTime,
  composeLocation,
  isRsvpAccepting,
  parseEventDate,
  parseRsvpDeadline,
  serializeEvent,
} from "@/lib/serializers";
import type { CreateEventInput } from "@/lib/schemas";
import { isEligibleReferrer } from "@/modules/events/lib/referrer";

export { assertPricingEditable } from "@/modules/events/lib/pricing-mode";

export const eventOptionsInclude = {
  schedules: { orderBy: { sortOrder: "asc" as const } },
  pricePlans: { orderBy: { sortOrder: "asc" as const } },
} satisfies Prisma.EventInclude;

type OptionInput = {
  schedules: { id?: string; eventDate: string; startTime: string; endTime: string }[];
  pricePlans: {
    id?: string;
    name: string;
    audience: "ANY" | "MALE" | "FEMALE";
    amount: number;
    note: string | null;
  }[];
};

/**
 * 表示用の開催場所を決める。構造化住所があればそこから組み立て、
 * 無ければ従来の自由入力をそのまま使う。
 */
export function resolveEventLocation(input: {
  location?: string | null;
  venueName?: string | null;
  prefecture?: string | null;
  city?: string | null;
  town?: string | null;
  addressLine?: string | null;
  building?: string | null;
}): string {
  const composed = composeLocation(input);
  if (!composed) {
    throw new ProblemDetailException({
      status: 400,
      title: "Validation Error",
      detail: "開催場所を入力してください。",
    });
  }
  if (composed.length > 255) {
    throw new ProblemDetailException({
      status: 400,
      title: "Validation Error",
      detail: "開催場所が長すぎます。会場名や建物名を短くしてください。",
    });
  }
  return composed;
}

/** イベント本体へ保存する住所の一式。location は表示用に合成する。 */
function addressData(input: {
  location?: string | null;
  postalCode?: string | null;
  prefecture?: string | null;
  city?: string | null;
  town?: string | null;
  addressLine?: string | null;
  building?: string | null;
  venueName?: string | null;
}) {
  return {
    location: resolveEventLocation(input),
    postalCode: input.postalCode ?? null,
    prefecture: input.prefecture ?? null,
    city: input.city ?? null,
    town: input.town ?? null,
    addressLine: input.addressLine ?? null,
    building: input.building ?? null,
    venueName: input.venueName ?? null,
  };
}

export function earliestSortDate(schedules: { eventDate: string }[]): Date {
  return schedules
    .map((row) => parseEventDate(row.eventDate))
    .reduce((earliest, date) => (date < earliest ? date : earliest));
}

/**
 * 勧誘カードからの参照元を確かめる。存在しない、削除済み、下書きのイベントは
 * 参照元にしない。不正な値でも作成は止めず、黙って NULL として扱う。
 */
async function resolveReferrerEventId(
  tx: Prisma.TransactionClient,
  referrerEventId: string | null | undefined,
): Promise<string | null> {
  if (!referrerEventId) return null;
  const referrer = await tx.event.findUnique({
    where: { id: referrerEventId },
    select: { id: true, isDeleted: true, status: true },
  });
  if (!referrer || !isEligibleReferrer(referrer)) return null;
  return referrer.id;
}

function optionCreateData(input: OptionInput) {
  return {
    sortDate: earliestSortDate(input.schedules),
    schedules: {
      create: input.schedules.map((row, sortOrder) => ({
        eventDate: parseEventDate(row.eventDate),
        startTime: row.startTime,
        endTime: row.endTime,
        eventTime: composeEventTime(row.startTime, row.endTime),
        sortOrder,
      })),
    },
    pricePlans: {
      create: input.pricePlans.map((row, sortOrder) => ({
        name: row.name,
        audience: row.audience,
        amount: row.amount,
        note: row.note,
        sortOrder,
      })),
    },
  };
}

export async function syncEventOptions(tx: Prisma.TransactionClient, eventId: string, input: OptionInput) {
  const [schedules, pricePlans] = await Promise.all([
    tx.eventSchedule.findMany({ where: { eventId }, select: { id: true } }),
    tx.eventPricePlan.findMany({ where: { eventId }, select: { id: true } }),
  ]);
  const scheduleIds = new Set(schedules.map((row) => row.id));
  const planIds = new Set(pricePlans.map((row) => row.id));
  const keepSchedules = new Set(input.schedules.flatMap((row) => (row.id && scheduleIds.has(row.id) ? [row.id] : [])));
  const keepPlans = new Set(input.pricePlans.flatMap((row) => (row.id && planIds.has(row.id) ? [row.id] : [])));
  const removeSchedules = schedules.filter((row) => !keepSchedules.has(row.id)).map((row) => row.id);
  const removePlans = pricePlans.filter((row) => !keepPlans.has(row.id)).map((row) => row.id);
  if (removeSchedules.length > 0) {
    await tx.eventSchedule.deleteMany({ where: { id: { in: removeSchedules } } });
  }
  if (removePlans.length > 0) {
    await tx.eventPricePlan.deleteMany({ where: { id: { in: removePlans } } });
  }
  for (const [sortOrder, row] of input.schedules.entries()) {
    const data = {
      eventDate: parseEventDate(row.eventDate),
      startTime: row.startTime,
      endTime: row.endTime,
      eventTime: composeEventTime(row.startTime, row.endTime),
      sortOrder,
    };
    if (row.id && scheduleIds.has(row.id)) {
      await tx.eventSchedule.update({ where: { id: row.id }, data });
    } else {
      await tx.eventSchedule.create({ data: { eventId, ...data } });
    }
  }
  for (const [sortOrder, row] of input.pricePlans.entries()) {
    const data = {
      name: row.name,
      audience: row.audience,
      amount: row.amount,
      note: row.note,
      sortOrder,
    };
    if (row.id && planIds.has(row.id)) {
      await tx.eventPricePlan.update({ where: { id: row.id }, data });
    } else {
      await tx.eventPricePlan.create({ data: { eventId, ...data } });
    }
  }
  await tx.event.update({
    where: { id: eventId },
    data: { sortDate: earliestSortDate(input.schedules) },
  });
}

export async function resolveAttendanceChoice(
  tx: Prisma.TransactionClient,
  eventId: string,
  input: {
    status: "ATTENDING" | "DECLINED";
    gender?: "MALE" | "FEMALE";
    scheduleId?: string;
    pricePlanId?: string;
  },
) {
  if (input.status !== "ATTENDING") {
    return {
      scheduleId: null,
      pricePlanId: null,
      priceAmount: null,
      pricePlanName: null,
      priceAudience: null,
    };
  }
  const [schedule, pricePlan] = await Promise.all([
    tx.eventSchedule.findFirst({ where: { id: input.scheduleId, eventId }, select: { id: true } }),
    tx.eventPricePlan.findFirst({
      where: { id: input.pricePlanId, eventId },
      select: { id: true, audience: true, amount: true, name: true },
    }),
  ]);
  if (!schedule || !pricePlan) {
    throw new ProblemDetailException({
      status: 400,
      title: "Validation Error",
      detail: "選んだ日時または費用プランがこのイベントにありません。",
    });
  }
  // 共通プランだけなら性別は聞かない。男女別プランを選ぶときだけ必須にする。
  if (pricePlan.audience !== "ANY" && !input.gender) {
    throw new ProblemDetailException({
      status: 400,
      title: "Validation Error",
      detail: "性別を選んでください。",
      error: "GENDER_REQUIRED",
    });
  }
  if (input.gender && !audiencesForGender(input.gender).includes(pricePlan.audience)) {
    throw new ProblemDetailException({
      status: 400,
      title: "Validation Error",
      detail: "選んだ性別では、その費用プランを選べません。",
      error: "PRICE_PLAN_GENDER_MISMATCH",
    });
  }
  return {
    scheduleId: schedule.id,
    pricePlanId: pricePlan.id,
    // 出欠確定時点の値を写す。プラン金額や名前を後から編集しても、この人の売上は動かない。
    priceAmount: pricePlan.amount,
    pricePlanName: pricePlan.name,
    priceAudience: pricePlan.audience,
  };
}

type PriceSnapshot = {
  pricePlanId: string | null;
  priceAmount: number | null;
  pricePlanName: string | null;
  priceAudience: "ANY" | "MALE" | "FEMALE" | null;
};

/**
 * 出欠を入れ直したときの金額の決め方。
 * 同じプランを選び直しているだけなら、申込時点の金額を保つ。
 * 幹事が名簿で名前だけ直したときに、あとから変えたプラン金額へ引きずられないようにする。
 * プランが変わったとき（欠席から出席へ戻したときを含む）は、いまの金額を写す。
 */
export function keepPriceSnapshot(current: PriceSnapshot, choice: PriceSnapshot) {
  if (choice.pricePlanId !== null && choice.pricePlanId === current.pricePlanId && current.priceAmount !== null) {
    return {
      priceAmount: current.priceAmount,
      pricePlanName: current.pricePlanName,
      priceAudience: current.priceAudience,
    };
  }
  return {
    priceAmount: choice.priceAmount,
    pricePlanName: choice.pricePlanName,
    priceAudience: choice.priceAudience,
  };
}

export function deadlineOrThrow(value: string | null): Date | null {
  if (!value) return null;
  const parsed = parseRsvpDeadline(value);
  if (!parsed) {
    throw new ProblemDetailException({
      status: 400,
      title: "Validation Error",
      detail: "実在する申し込み期限を入力してください。",
    });
  }
  return parsed;
}

export function assertRsvpOpen(event: { status: string; rsvpDeadline: Date | null }): void {
  if (isRsvpAccepting(event)) return;
  const expired = event.status === "PUBLISHED" && event.rsvpDeadline !== null;
  throw new ProblemDetailException({
    status: 403,
    title: "Forbidden",
    detail: expired
      ? "申し込み期限を過ぎているため、出欠の新規登録と変更はできません。"
      : "このイベントは出欠を受け付けていません。",
  });
}

function mapForeignKey(error: unknown): never {
  if (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2003"
  ) {
    throw new ProblemDetailException({
      status: 400,
      title: "Validation Error",
      detail: "指定されたチラシアセットが存在しません。",
    });
  }
  throw error;
}

export async function createEventForUser(userId: string, input: CreateEventInput) {
  const decision = await assertCanCreateEvent(userId);
  try {
    return await prisma.$transaction(async (tx) => {
      const planType = await decision.consume(tx);
      const referrerEventId = await resolveReferrerEventId(tx, input.referrerEventId);
      const event = await tx.event.create({
        data: {
          title: input.title,
          ...optionCreateData(input),
          ...addressData(input),
          rainPolicy: input.rainPolicy,
          capacity: input.capacity ?? null,
          flyerAssetId: input.flyerAssetId ?? null,
          referrerEventId,
          // 一覧を持たないため、作成時は常に紹介制で保存する。値は将来のメディアサイト用に残す。
          visibility: "UNLISTED",
          rsvpDeadline: deadlineOrThrow(input.rsvpDeadline),
          status: "PUBLISHED",
        },
        include: { flyerAsset: true, ...eventOptionsInclude },
      });
      await tx.eventOrganizer.create({
        data: {
          eventId: event.id,
          userId,
          role: "OWNER",
        },
      });
      return { event, planType, guestOrganizerToken: null as string | null };
    });
  } catch (error) {
    mapForeignKey(error);
  }
}

export async function createEventForGuest(input: CreateEventInput, guestTokenHash: string) {
  try {
    return await prisma.$transaction(async (tx) => {
      const referrerEventId = await resolveReferrerEventId(tx, input.referrerEventId);
      const event = await tx.event.create({
        data: {
          title: input.title,
          ...optionCreateData(input),
          ...addressData(input),
          rainPolicy: input.rainPolicy,
          capacity: input.capacity ?? null,
          flyerAssetId: input.flyerAssetId ?? null,
          referrerEventId,
          // 一覧を持たないため、作成時は常に紹介制で保存する。値は将来のメディアサイト用に残す。
          visibility: "UNLISTED",
          rsvpDeadline: deadlineOrThrow(input.rsvpDeadline),
          status: "PUBLISHED",
        },
        include: { flyerAsset: true, ...eventOptionsInclude },
      });
      await tx.eventOrganizer.create({
        data: {
          eventId: event.id,
          guestTokenHash,
          role: "OWNER",
          displayName: input.organizerDisplayName ?? null,
        },
      });
      return event;
    });
  } catch (error) {
    mapForeignKey(error);
  }
}

export function createdEventBody(
  event: NonNullable<Awaited<ReturnType<typeof createEventForGuest>>>,
  guestOrganizerToken: string | null,
) {
  return {
    event: serializeEvent(event),
    guestOrganizerToken,
    publicUrl: `/events/${event.id}`,
    manageUrl: `/organizer/events/${event.id}`,
  };
}

export async function assertCapacityAllows(
  tx: Prisma.TransactionClient,
  eventId: string,
  status: "ATTENDING" | "DECLINED",
  ignoreParticipantId?: string,
): Promise<void> {
  if (status !== "ATTENDING") return;
  const event = await tx.event.findUnique({
    where: { id: eventId },
    select: { capacity: true },
  });
  if (!event?.capacity) return;
  const attendingCount = await tx.participant.count({
    where: {
      eventId,
      status: "ATTENDING",
      ...(ignoreParticipantId ? { id: { not: ignoreParticipantId } } : {}),
    },
  });
  if (attendingCount >= event.capacity) {
    throw new ProblemDetailException({
      status: 409,
      title: "Capacity Reached",
      type: "probs/capacity-reached",
      detail: "定員に達しているため、参加での回答はできません。",
      error: "CAPACITY_REACHED",
    });
  }
}
