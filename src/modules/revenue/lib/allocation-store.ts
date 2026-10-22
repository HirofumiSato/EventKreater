import type { RevenueShareVisibility, RevenueSplitMode } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { AllocationInputRow } from "@/modules/revenue/lib/allocation";

export interface SaveAllocationInput {
  eventId: string;
  mode: RevenueSplitMode;
  visibility: RevenueShareVisibility;
  /** このイベントの主催者全員ぶん。検証済みであることを前提にする。 */
  rows: readonly AllocationInputRow[];
  organizerIds: readonly string[];
  updatedByUserId: string;
}

/**
 * 按分の設定と配分を1トランザクションで保存する。
 * 割合方式で使わない headcount、人数方式で使わない shareBps は null にして、
 * 方式を切り替えても古い値が残らないようにする。
 */
export async function saveAllocationSetting(input: SaveAllocationInput): Promise<void> {
  const values = new Map(input.rows.map((row) => [row.organizerId, row]));

  await prisma.$transaction(async (tx) => {
    await tx.eventRevenueSetting.upsert({
      where: { eventId: input.eventId },
      create: {
        eventId: input.eventId,
        mode: input.mode,
        visibility: input.visibility,
        updatedByUserId: input.updatedByUserId,
      },
      update: {
        mode: input.mode,
        visibility: input.visibility,
        updatedByUserId: input.updatedByUserId,
      },
    });

    for (const organizerId of input.organizerIds) {
      const row = values.get(organizerId);
      const shareBps = input.mode === "RATIO" ? (row?.shareBps ?? 0) : null;
      const headcount = input.mode === "HEADCOUNT" ? (row?.headcount ?? 0) : null;
      await tx.eventRevenueShare.upsert({
        where: { organizerId },
        create: { organizerId, eventId: input.eventId, shareBps, headcount },
        update: { shareBps, headcount },
      });
    }

    // 主催者から外れた行は Cascade で消えるが、取りこぼしがあっても残さない。
    await tx.eventRevenueShare.deleteMany({
      where: { eventId: input.eventId, organizerId: { notIn: [...input.organizerIds] } },
    });
  });
}
