import type { PlatformRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { formatEventDate } from "@/lib/serializers";
import { ProblemDetailException } from "@/lib/exceptions";
import { maskPhone } from "@/modules/auth/lib/login-challenge";
import { organizerLabel } from "@/modules/organizers/lib/names";

export const ADMIN_PAGE_SIZE = 30;

export function parseAdminListQuery(searchParams: URLSearchParams): { q: string; page: number; offset: number } {
  const q = (searchParams.get("q") ?? "").trim().slice(0, 100);
  const rawPage = Number(searchParams.get("page") ?? "1");
  const page = Number.isFinite(rawPage) && rawPage >= 1 ? Math.min(Math.floor(rawPage), 1000) : 1;
  return { q, page, offset: (page - 1) * ADMIN_PAGE_SIZE };
}

export async function searchAdminUsers(q: string, offset: number) {
  const where = q
    ? {
        OR: [
          { name: { contains: q, mode: "insensitive" as const } },
          { email: { contains: q, mode: "insensitive" as const } },
          { phoneE164: { contains: q, mode: "insensitive" as const } },
        ],
      }
    : {};
  const [total, rows] = await Promise.all([
    prisma.user.count({ where }),
    prisma.user.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: offset,
      take: ADMIN_PAGE_SIZE,
      select: {
        id: true,
        email: true,
        name: true,
        platformRole: true,
        passwordHash: true,
        phoneE164: true,
        phoneVerifiedAt: true,
        deletedAt: true,
        createdAt: true,
        _count: { select: { organizers: true, participants: true } },
      },
    }),
  ]);
  return {
    total,
    users: rows.map((row) => ({
      id: row.id,
      email: row.email,
      name: row.name,
      platformRole: row.platformRole,
      hasPassword: Boolean(row.passwordHash),
      // 退会済みでも一覧には残す。生の番号は出さず、下4桁だけを見せる。
      withdrawn: Boolean(row.deletedAt),
      deletedAt: row.deletedAt ? row.deletedAt.toISOString() : null,
      phoneMasked: row.phoneE164 ? maskPhone(row.phoneE164) : null,
      phoneVerified: Boolean(row.phoneVerifiedAt),
      createdAt: row.createdAt.toISOString(),
      organizerCount: row._count.organizers,
      participantCount: row._count.participants,
    })),
  };
}

export async function updatePlatformRole(actorId: string, userId: string, platformRole: PlatformRole) {
  if (actorId === userId) {
    throw new ProblemDetailException({
      status: 403,
      title: "Forbidden",
      detail: "自分の権限は変更できません。",
    });
  }
  const existing = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, deletedAt: true },
  });
  if (!existing) {
    throw new ProblemDetailException({
      status: 404,
      title: "Not Found",
      detail: "会員が見つかりません。",
    });
  }
  if (existing.deletedAt) {
    throw new ProblemDetailException({
      status: 400,
      title: "Validation Error",
      detail: "退会済みの会員の権限は変更できません。",
    });
  }
  const updated = await prisma.user.update({
    where: { id: userId },
    data: { platformRole },
    select: { id: true, email: true, name: true, platformRole: true },
  });
  return updated;
}

export async function searchAdminEvents(q: string, offset: number) {
  const where = q
    ? {
        OR: [
          { title: { contains: q, mode: "insensitive" as const } },
          { location: { contains: q, mode: "insensitive" as const } },
          {
            organizers: {
              some: {
                user: {
                  OR: [
                    { name: { contains: q, mode: "insensitive" as const } },
                    { email: { contains: q, mode: "insensitive" as const } },
                  ],
                },
              },
            },
          },
          // 未登録の筆頭幹事は、公開ページに出している名前で検索できるようにする。
          {
            organizers: {
              some: { displayName: { contains: q, mode: "insensitive" as const } },
            },
          },
        ],
      }
    : {};
  const [total, rows] = await Promise.all([
    prisma.event.count({ where }),
    prisma.event.findMany({
      where,
      orderBy: [{ createdAt: "desc" }],
      skip: offset,
      take: ADMIN_PAGE_SIZE,
      select: {
        id: true,
        title: true,
        location: true,
        status: true,
        visibility: true,
        isDeleted: true,
        sortDate: true,
        createdAt: true,
        _count: { select: { participants: true, organizers: true } },
        organizers: {
          select: {
            role: true,
            userId: true,
            displayName: true,
            user: { select: { id: true, name: true, email: true } },
          },
          orderBy: { createdAt: "asc" },
        },
      },
    }),
  ]);
  return {
    total,
    events: rows.map((row) => {
      const ownerRow = row.organizers.find((organizer) => organizer.role === "OWNER") ?? null;
      const owner = ownerRow
        ? {
            id: ownerRow.user?.id ?? null,
            name: organizerLabel(ownerRow),
            email: ownerRow.user?.email ?? null,
            isGuest: !ownerRow.userId,
          }
        : null;
      return {
        id: row.id,
        title: row.title,
        location: row.location,
        status: row.status,
        visibility: row.visibility,
        isDeleted: row.isDeleted,
        sortDate: formatEventDate(row.sortDate),
        createdAt: row.createdAt.toISOString(),
        participantCount: row._count.participants,
        organizerCount: row._count.organizers,
        coHostCount: row.organizers.filter((organizer) => organizer.role === "CO_HOST").length,
        coHostNames: row.organizers
          .filter((organizer) => organizer.role === "CO_HOST")
          .map((organizer) => organizerLabel(organizer)),
        owner,
        publicPath: !row.isDeleted && row.status !== "DRAFT" ? `/events/${row.id}` : null,
      };
    }),
  };
}

export async function searchAdminPayments(q: string, offset: number) {
  const where = q
    ? {
        OR: [
          { user: { name: { contains: q, mode: "insensitive" as const } } },
          { user: { email: { contains: q, mode: "insensitive" as const } } },
          { stripeCheckoutSessionId: { contains: q, mode: "insensitive" as const } },
          { stripeInvoiceId: { contains: q, mode: "insensitive" as const } },
          { stripePaymentIntentId: { contains: q, mode: "insensitive" as const } },
        ],
      }
    : {};
  const [total, rows] = await Promise.all([
    prisma.billingTransaction.count({ where }),
    prisma.billingTransaction.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: offset,
      take: ADMIN_PAGE_SIZE,
      select: {
        id: true,
        paymentType: true,
        paymentStatus: true,
        amount: true,
        currency: true,
        stripeCheckoutSessionId: true,
        stripePaymentIntentId: true,
        stripeInvoiceId: true,
        createdAt: true,
        user: { select: { id: true, name: true, email: true } },
      },
    }),
  ]);
  return {
    total,
    payments: rows.map((row) => ({
      id: row.id,
      paymentType: row.paymentType,
      paymentStatus: row.paymentStatus,
      amount: row.amount,
      currency: row.currency,
      stripeCheckoutSessionId: row.stripeCheckoutSessionId,
      stripePaymentIntentId: row.stripePaymentIntentId,
      stripeInvoiceId: row.stripeInvoiceId,
      createdAt: row.createdAt.toISOString(),
      user: row.user,
    })),
  };
}
