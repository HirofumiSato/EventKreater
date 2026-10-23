import { NextRequest, NextResponse } from "next/server";
import { ProblemDetailException } from "@/lib/exceptions";
import { assertOrganizer } from "@/modules/auth/lib/guards";
import { toErrorResponse } from "@/lib/http";
import { UpdateEventSchema } from "@/lib/schemas";
import { serializeEvent } from "@/lib/serializers";
import { publishDraftEvent } from "@/modules/events/lib/events";
import {
  rememberVenueQuietly,
  writeVenueOwnerCookie,
} from "@/modules/events/lib/venue-suggestions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: { id: string };
}

const UUID_PATTERN = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

/**
 * 下書きを公開する。作成画面は編集ロックを持たないため、`PUT` ではなくこの入口を使う。
 * 本文を付けると、公開と同時に内容も更新する（購入後に復元したフォームの保存を兼ねる）。
 */
export async function POST(req: NextRequest, { params }: RouteContext) {
  try {
    if (!UUID_PATTERN.test(params.id)) {
      throw new ProblemDetailException({
        status: 404,
        title: "Not Found",
        detail: "イベントが見つかりません。",
      });
    }
    const ctx = await assertOrganizer(req, params.id);
    if (!ctx.userId || ctx.role !== "OWNER") {
      throw new ProblemDetailException({
        status: 403,
        title: "Forbidden",
        detail: "下書きの公開は筆頭幹事（オーナー）の会員だけが行えます。",
      });
    }

    const raw = await req.json().catch(() => null);
    const input =
      raw && typeof raw === "object" && Object.keys(raw).length > 0
        ? UpdateEventSchema.parse(raw)
        : null;

    const event = await publishDraftEvent(ctx.userId, params.id, input);
    const response = NextResponse.json({
      event: serializeEvent(event),
      publicUrl: `/events/${event.id}`,
      manageUrl: `/organizer/events/${event.id}`,
    });
    if (input) {
      const venueCookie = await rememberVenueQuietly(req, input);
      writeVenueOwnerCookie(response, req, venueCookie);
    }
    return response;
  } catch (error) {
    return toErrorResponse(error, `/api/v1/organizer/events/${params.id}/publish`);
  }
}
