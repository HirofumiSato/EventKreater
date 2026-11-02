import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ProblemDetailException, isUniqueViolation } from "@/lib/exceptions";
import {
  REFERRAL_TICKET_LIMIT,
  nextAdGrantAt,
  referralGrantSize,
  ticketExpiresAt,
} from "@/modules/billing/lib/tickets";
import {
  generateReferralCode,
  isSelfReferral,
  referralReasonKey,
} from "@/modules/billing/lib/referral-code";

/**
 * 紹介のコードと、紹介で配るチケットを持つ。
 *
 * 数え上げは `free_tickets` を `grantedByUserId` で数える。枚数の写しは持たない
 * （2か所に同じ数を持つと、付与が途中で落ちたときに食い違う）。
 */

/** 衝突したときの作り直し回数。8文字の英数なので、実際には1回で決まる。 */
const CODE_ATTEMPTS = 5;

/**
 * 自分の紹介コード。未発行なら作る。
 *
 * 退会した会員のコードも残す（URL を踏んだ人が、退会者を紹介者にしないため
 * `resolveReferrer` が `deletedAt` で弾く）。既にあるコードは変えない。
 */
export async function ensureReferralCode(userId: string): Promise<string> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { referralCode: true },
  });
  if (user?.referralCode) return user.referralCode;

  for (let attempt = 0; attempt < CODE_ATTEMPTS; attempt += 1) {
    try {
      const updated = await prisma.user.update({
        where: { id: userId },
        data: { referralCode: generateReferralCode() },
        select: { referralCode: true },
      });
      if (updated.referralCode) return updated.referralCode;
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
    }
  }
  throw new ProblemDetailException({
    status: 500,
    title: "Internal Server Error",
    detail: "紹介コードを作れませんでした。時間をおいて試してください。",
  });
}

/**
 * 紹介コードから紹介者を引く。存在しないコードと退会者は null。
 * 自分で自分を紹介した場合の判定は、呼び出し側（`grantReferralTickets`）が行う。
 */
export async function resolveReferrer(
  code: string,
  db: Prisma.TransactionClient | typeof prisma = prisma,
): Promise<{ id: string } | null> {
  if (!code) return null;
  return db.user.findFirst({
    where: { referralCode: code, deletedAt: null },
    select: { id: true },
  });
}

/** 付与の結果。配らなかったときは `null`（紹介なし・自己紹介・退会・上限・付与済み）。 */
export interface ReferralGrant {
  /** チケットを受け取った紹介者。通知の宛先になる。 */
  referrerId: string;
  /** 今回配った枚数。 */
  granted: number;
}

/**
 * 紹介された人の初回公開で、紹介者にチケットを配る。配った相手と枚数を返す。
 *
 * `reasonKey = "referral:<新規userId>:<n>"` の UNIQUE で冪等。何度呼んでも増えない。
 * 生涯上限を超えないよう、紹介者の行を `FOR UPDATE` で押さえてから数える
 * （2人が同時に公開しても、上限を1枚も超えない）。
 */
export async function grantReferralTickets(
  tx: Prisma.TransactionClient,
  newUserId: string,
): Promise<ReferralGrant | null> {
  const user = await tx.user.findUnique({
    where: { id: newUserId },
    select: { referredByUserId: true },
  });
  const referrerId = user?.referredByUserId;
  // 自己紹介と、紹介なしの登録は配らない。
  if (!referrerId || isSelfReferral(referrerId, newUserId)) return null;

  await tx.$queryRaw`SELECT id FROM users WHERE id = ${referrerId}::uuid FOR UPDATE`;

  const referrer = await tx.user.findUnique({
    where: { id: referrerId },
    select: { deletedAt: true },
  });
  if (!referrer || referrer.deletedAt) return null;

  const grantedCount = await tx.freeTicket.count({
    where: { userId: referrerId, source: "REFERRAL" },
  });
  const size = referralGrantSize(grantedCount);
  if (size === 0) return null;

  const issuedAt = new Date();
  const expiresAt = ticketExpiresAt("REFERRAL", issuedAt);
  const created = await tx.freeTicket.createMany({
    data: Array.from({ length: size }, (_, index) => ({
      userId: referrerId,
      source: "REFERRAL" as const,
      grantedByUserId: newUserId,
      reasonKey: referralReasonKey(newUserId, index),
      issuedAt,
      expiresAt,
    })),
    skipDuplicates: true,
  });
  // すでに配った相手なら 0 枚。通知も作らない（呼び出し側は null で判断する）。
  if (created.count === 0) return null;
  return { referrerId, granted: created.count };
}

export interface TicketSummary {
  available: number;
  expiringAt: string | null;
  ad: { nextGrantAt: string | null };
  referral: { code: string | null; grantedCount: number; limit: number };
}

/**
 * 画面と API に出す、チケットの残りと実績。
 *
 * `available` は期限内で未使用の枚数。`expiringAt` はそのうち最も早い期限。
 * `referral.grantedCount` はこの人が紹介で配った枚数（生涯上限の数え上げと同じ）。
 */
export async function readTicketSummary(
  userId: string,
  now = new Date(),
): Promise<TicketSummary> {
  const [tickets, lastAdTicket, grantedCount, user] = await Promise.all([
    prisma.freeTicket.findMany({
      where: { userId, usedAt: null, expiresAt: { gt: now } },
      orderBy: { expiresAt: "asc" },
      select: { expiresAt: true },
    }),
    prisma.freeTicket.findFirst({
      where: { userId, source: "AD" },
      orderBy: { issuedAt: "desc" },
      select: { issuedAt: true },
    }),
    prisma.freeTicket.count({ where: { grantedByUserId: userId, source: "REFERRAL" } }),
    prisma.user.findUnique({ where: { id: userId }, select: { referralCode: true } }),
  ]);

  const nextGrantAt = lastAdTicket ? nextAdGrantAt(lastAdTicket.issuedAt, now) : null;
  return {
    available: tickets.length,
    expiringAt: tickets[0]?.expiresAt.toISOString() ?? null,
    ad: { nextGrantAt: nextGrantAt ? nextGrantAt.toISOString() : null },
    referral: {
      code: user?.referralCode ?? null,
      grantedCount,
      limit: REFERRAL_TICKET_LIMIT,
    },
  };
}
