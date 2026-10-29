import { prisma } from "@/lib/prisma";
import type { EventStatus, QuotaSource } from "@prisma/client";

interface SeedOptions {
  guestTokenHash?: string;
  userId?: string;
  role?: "OWNER" | "CO_HOST";
  isDeleted?: boolean;
  status?: EventStatus;
  /** 公開のときに消費した枠。公開中の件数を数える側が使う。 */
  quotaSource?: QuotaSource | null;
  /** 作成時に利用枠を消費済みか。複製が作った下書きを表す。 */
  quotaChargedAt?: Date | null;
  /** 開催日（UTC 0 時）。公開中の判定はこの日付で行う。 */
  scheduleDates?: Date[];
}

/** 結合テスト用のイベント。日時候補や料金プランは必須ではないので作らない。 */
export async function seedEvent(options: SeedOptions = {}) {
  const scheduleDates = options.scheduleDates ?? [];
  return prisma.event.create({
    data: {
      title: "テスト用イベント",
      sortDate: new Date("2026-12-01T00:00:00.000Z"),
      location: "テスト会場",
      visibility: "UNLISTED",
      status: options.status ?? "PUBLISHED",
      quotaChargedAt: options.quotaChargedAt ?? null,
      quotaSource: options.quotaSource ?? null,
      isDeleted: options.isDeleted ?? false,
      organizers: {
        create: {
          guestTokenHash: options.guestTokenHash ?? null,
          userId: options.userId ?? null,
          role: options.role ?? "OWNER",
        },
      },
      schedules:
        scheduleDates.length > 0
          ? {
              create: scheduleDates.map((eventDate, index) => ({
                eventDate,
                eventTime: "18:00〜20:00",
                startTime: "18:00",
                endTime: "20:00",
                sortOrder: index,
              })),
            }
          : undefined,
    },
    include: { organizers: true },
  });
}

export async function cleanup(ids: { eventIds: string[]; userIds: string[] }): Promise<void> {
  if (ids.eventIds.length > 0) {
    await prisma.event.deleteMany({ where: { id: { in: ids.eventIds } } });
  }
  if (ids.userIds.length > 0) {
    await prisma.user.deleteMany({ where: { id: { in: ids.userIds } } });
  }
}

export function uniqueEmail(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}@example.invalid`;
}
