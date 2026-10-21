import { prisma } from "@/lib/prisma";
import { appBaseUrl } from "@/lib/http";
import { isUniqueViolation } from "@/lib/exceptions";
import { deliverMail } from "@/lib/mail";
import { SITE } from "@/lib/site";
import { SUBSCRIPTION_PRICE_JPY } from "@/modules/billing/lib/plans";

/**
 * 0円（または割引）の月額が終わる前の案内。
 * 3日前と1日前の2回だけ送り、同じ無料期間には二度と送らない。
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** 3日前の案内を拾い始める範囲。毎日1回の実行を前提に、少し余裕を持たせる。 */
const NOTICE_WINDOW_MS = 3 * DAY_MS + 12 * 60 * 60 * 1000;

export type NoticeKind = "FREE_PERIOD_ENDING_3D" | "FREE_PERIOD_ENDING_1D";

export interface NoticeRunResult {
  scanned: number;
  sent: number;
  recorded: number;
  skipped: number;
  notices: Array<{
    userId: string;
    kind: NoticeKind;
    periodEnd: string;
    status: "SENT" | "RECORDED" | "SKIPPED";
  }>;
}

function jstLabel(date: Date): string {
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function buildMessage(input: {
  name: string;
  campaignName: string | null;
  percent: number;
  periodEnd: Date;
  kind: NoticeKind;
}): { subject: string; body: string } {
  const origin = appBaseUrl();
  const when = jstLabel(input.periodEnd);
  const isFree = input.percent >= 100;
  const price = SUBSCRIPTION_PRICE_JPY.toLocaleString("ja-JP");
  const remaining = input.kind === "FREE_PERIOD_ENDING_3D" ? "3日" : "1日";
  const label = isFree ? "無料期間" : "割引期間";
  const campaign = input.campaignName ? `${input.campaignName} の` : "";

  const subject = isFree
    ? `【まもなく終了】月額プランの無料期間が${remaining}後に終わります`
    : `【まもなく終了】月額プランの割引期間が${remaining}後に終わります`;

  const body = [
    `${input.name} 様`,
    "",
    `${campaign}月額プランの${label}が ${when} に終了します。`,
    isFree
      ? `終了後は、ご登録のカードへ月額 ${price}円（税込）を自動で請求します。`
      : `終了後は、月額 ${price}円（税込）の通常料金へ戻ります。`,
    "",
    `継続しない場合は、${label}が終わるまでにマイページの「お支払い管理」から解約してください。`,
    `解約しても、${label}の終了日までは現在の料金でご利用いただけます。`,
    "",
    `お支払い管理: ${origin}/mypage`,
    `料金: ${origin}/service`,
    `利用規約: ${origin}/terms`,
    "",
    `このメールは ${SITE.name} の${label}終了前のご案内として、${remaining}前にお送りしています。`,
  ].join("\n");

  return { subject: subject.slice(0, 200), body };
}

/**
 * 無料期間・割引期間が 3日以内に終わる契約へ案内を送る。
 * cron から1日1回呼ぶ想定。重複は (userId, kind, periodEnd) の一意制約で防ぐ。
 */
export async function sendFreePeriodEndingNotices(
  now = new Date(),
): Promise<NoticeRunResult> {
  const quotas = await prisma.userUsageQuota.findMany({
    where: {
      subscriptionStatus: "ACTIVE",
      discountEndsAt: {
        gt: now,
        lte: new Date(now.getTime() + NOTICE_WINDOW_MS),
      },
    },
    include: {
      user: { select: { id: true, name: true, email: true } },
      pricingCampaign: { select: { name: true } },
    },
  });

  const result: NoticeRunResult = {
    scanned: quotas.length,
    sent: 0,
    recorded: 0,
    skipped: 0,
    notices: [],
  };
  if (quotas.length === 0) return result;

  for (const quota of quotas) {
    const periodEnd = quota.discountEndsAt;
    if (!periodEnd || !quota.user) continue;

    const remaining = periodEnd.getTime() - now.getTime();
    const kind: NoticeKind =
      remaining <= DAY_MS ? "FREE_PERIOD_ENDING_1D" : "FREE_PERIOD_ENDING_3D";

    const already = await prisma.billingNotice.findUnique({
      where: {
        userId_kind_periodEnd: { userId: quota.userId, kind, periodEnd },
      },
    });
    if (already) {
      result.skipped += 1;
      result.notices.push({
        userId: quota.userId,
        kind,
        periodEnd: periodEnd.toISOString(),
        status: "SKIPPED",
      });
      continue;
    }

    const percent = quota.discountPercent ?? (quota.pricingCampaign ? 100 : 0);
    const { subject, body } = buildMessage({
      name: quota.user.name,
      campaignName: quota.pricingCampaign?.name ?? null,
      percent,
      periodEnd,
      kind,
    });
    const status = await deliverMail({ to: quota.user.email, subject, body });

    try {
      await prisma.billingNotice.create({
        data: {
          userId: quota.userId,
          campaignId: quota.pricingCampaignId,
          kind,
          periodEnd,
          recipientEmail: quota.user.email,
          subject,
          body,
          status,
        },
      });
    } catch (error) {
      // 同時に走った別のワーカーが先に記録した。
      if (!isUniqueViolation(error)) throw error;
      result.skipped += 1;
      continue;
    }

    if (status === "SENT") result.sent += 1;
    else result.recorded += 1;
    result.notices.push({
      userId: quota.userId,
      kind,
      periodEnd: periodEnd.toISOString(),
      status,
    });
  }

  return result;
}
