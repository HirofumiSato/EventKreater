import { prisma } from "@/lib/prisma";
import type { EventStatus } from "@prisma/client";

interface SeedOptions {
  guestTokenHash?: string;
  userId?: string;
  role?: "OWNER" | "CO_HOST";
  isDeleted?: boolean;
  status?: EventStatus;
  /** 作成時に利用枠を消費済みか。複製が作った下書きを表す。 */
  quotaChargedAt?: Date | null;
}

/** 結合テスト用のイベント。日時候補や料金プランは必須ではないので作らない。 */
export async function seedEvent(options: SeedOptions = {}) {
  return prisma.event.create({
    data: {
      title: "テスト用イベント",
      sortDate: new Date("2026-12-01T00:00:00.000Z"),
      location: "テスト会場",
      visibility: "UNLISTED",
      status: options.status ?? "PUBLISHED",
      quotaChargedAt: options.quotaChargedAt ?? null,
      isDeleted: options.isDeleted ?? false,
      organizers: {
        create: {
          guestTokenHash: options.guestTokenHash ?? null,
          userId: options.userId ?? null,
          role: options.role ?? "OWNER",
        },
      },
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
