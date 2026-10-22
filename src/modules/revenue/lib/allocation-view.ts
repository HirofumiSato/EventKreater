import type { OrganizerRole, RevenueShareVisibility, RevenueSplitMode } from "@prisma/client";
import { isGuestOrganizer, organizerLabel } from "@/modules/organizers/lib/names";
import {
  allocateRevenue,
  isAllocationConfigured,
  type AllocationOrganizer,
  type AllocationShare,
} from "@/modules/revenue/lib/allocation";
import type { RevenueAllocationView } from "@/modules/revenue/types";

export interface AllocationOrganizerSource {
  id: string;
  role: OrganizerRole;
  userId: string | null;
  displayName: string | null;
  user: { name: string | null } | null;
}

export interface BuildAllocationViewInput {
  organizers: readonly AllocationOrganizerSource[];
  setting: { mode: RevenueSplitMode; visibility: RevenueShareVisibility } | null;
  shares: readonly AllocationShare[];
  viewerUserId: string;
  viewerRole: OrganizerRole;
  expectedRevenue: number;
  issuedRevenue: number;
  attendingCount: number;
}

/**
 * 按分の表示用データを組み立てる。
 * 絞り込みはサーバーで行い、画面側で隠すだけにはしない。
 */
export function buildAllocationView(input: BuildAllocationViewInput): RevenueAllocationView {
  const mode = input.setting?.mode ?? "RATIO";
  const visibility = input.setting?.visibility ?? "OWN_ONLY";

  const organizers: AllocationOrganizer[] = input.organizers.map((row) => ({
    organizerId: row.id,
    role: row.role,
  }));

  const allocation = allocateRevenue({
    mode,
    organizers,
    shares: input.shares,
    expectedRevenue: input.expectedRevenue,
    issuedRevenue: input.issuedRevenue,
    attendingCount: input.attendingCount,
  });

  const viewerOrganizer = input.organizers.find((row) => row.userId === input.viewerUserId);
  const canSeeAll = input.viewerRole === "OWNER" || visibility === "ALL";

  const rows = input.organizers.flatMap((source, index) => {
    const row = allocation.rows[index];
    if (!row) return [];
    const isYou = source.id === viewerOrganizer?.id;
    if (!canSeeAll && !isYou) return [];
    return [
      {
        organizerId: source.id,
        name: organizerLabel(source),
        role: source.role,
        isGuest: isGuestOrganizer(source),
        isYou,
        shareBps: row.shareBps,
        headcount: row.headcount,
        expectedRevenue: row.expectedRevenue,
        issuedRevenue: row.issuedRevenue,
      },
    ];
  });

  return {
    configured: isAllocationConfigured(mode, organizers, input.shares),
    mode,
    visibility,
    canEdit: input.viewerRole === "OWNER",
    organizerCount: input.organizers.length,
    rows,
    unallocated: allocation.unallocated,
    hiddenRows: input.organizers.length - rows.length,
  };
}
