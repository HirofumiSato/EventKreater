import { NextRequest, NextResponse } from "next/server";
import { ProblemDetailException } from "@/lib/exceptions";
import { toErrorResponse } from "@/lib/http";
import { isUserId } from "@/lib/ids";
import { loadPublicOrganizerProfile } from "@/modules/organizers/lib/profile-store";
import type { PublicOrganizerProfileResponse } from "@/modules/organizers/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: { userId: string };
}

/**
 * 主催者の公開プロフィール（`/organizers/[userId]`）。
 *
 * 誰でも読める。ただし非公開の会員は名前と `isPublished: false` だけを返し、
 * 自己紹介・リンク・実績はDBから読んでもここを通さない。
 * 会員が無い・退会済み・催しが0件なら 404。
 */
export async function GET(_req: NextRequest, { params }: RouteContext) {
  try {
    if (!isUserId(params.userId)) {
      throw new ProblemDetailException({
        status: 404,
        title: "Not Found",
        detail: "主催者が見つかりません。",
      });
    }

    const loaded = await loadPublicOrganizerProfile(params.userId);
    if (!loaded) {
      throw new ProblemDetailException({
        status: 404,
        title: "Not Found",
        detail: "主催者が見つかりません。",
      });
    }

    const body: PublicOrganizerProfileResponse = {
      userId: loaded.userId,
      name: loaded.name,
      profile: loaded.profile,
    };
    return NextResponse.json(body);
  } catch (error) {
    return toErrorResponse(error, `/api/v1/public/organizers/${params.userId}`);
  }
}
