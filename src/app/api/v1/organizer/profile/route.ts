import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { toErrorResponse } from "@/lib/http";
import { OrganizerProfileSchema } from "@/lib/schemas";
import { requireOrganizerAccount } from "@/modules/auth/lib/guards";
import { organizerProfilePath } from "@/modules/organizers/lib/public-page";
import {
  assertOrganizerMember,
  readOrganizerProfileDraft,
  readOrganizerProfileStats,
  upsertOrganizerProfile,
} from "@/modules/organizers/lib/profile-store";
import type { OrganizerProfileDraftResponse } from "@/modules/organizers/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 主催者本人のプロフィール設定（SCR-ORG-14）。
 *
 * 主催イベントを1件以上持つ会員だけが使える。ゲスト幹事は会員登録へ送る。
 * 公開ページの表示名は `users.name` なので、ここでは変えない。
 */
async function loadResponse(userId: string): Promise<OrganizerProfileDraftResponse> {
  const [user, profile, stats] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { name: true } }),
    readOrganizerProfileDraft(userId),
    readOrganizerProfileStats(userId),
  ]);
  return {
    name: user?.name ?? "",
    profile,
    stats,
    homePath: organizerProfilePath(userId),
  };
}

export async function GET(req: NextRequest) {
  try {
    const userId = await requireOrganizerAccount(req);
    await assertOrganizerMember(userId);
    return NextResponse.json(await loadResponse(userId));
  } catch (error) {
    return toErrorResponse(error, "/api/v1/organizer/profile");
  }
}

export async function PUT(req: NextRequest) {
  try {
    const userId = await requireOrganizerAccount(req);
    await assertOrganizerMember(userId);
    const payload = OrganizerProfileSchema.parse(await req.json());
    await upsertOrganizerProfile(userId, payload);
    return NextResponse.json(await loadResponse(userId));
  } catch (error) {
    return toErrorResponse(error, "/api/v1/organizer/profile");
  }
}
