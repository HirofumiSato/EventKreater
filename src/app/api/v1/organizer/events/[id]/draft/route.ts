import { NextRequest, NextResponse } from "next/server";
import { ProblemDetailException } from "@/lib/exceptions";
import { assertOrganizer } from "@/modules/auth/lib/guards";
import { toErrorResponse } from "@/lib/http";
import { SaveEventDraftSchema } from "@/lib/schemas";
import { serializeEvent } from "@/lib/serializers";
import { assertDraftSaveStatus } from "@/modules/events/lib/draft";
import { saveEventDraft } from "@/modules/events/lib/events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: { id: string };
}

const UUID_PATTERN = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

/**
 * 作成画面からの下書き保存。
 *
 * 2回目以降の保存はこの入口を使う。編集画面の `PUT` は排他ロックを要求するが、
 * 作成画面はロックを持たず、競合モーダルも置いていないため。
 * 公開は `POST .../publish` で行う（状態はここでは変えない）。
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
    if (!ctx.userId) {
      throw new ProblemDetailException({
        status: 403,
        title: "Forbidden",
        type: "probs/register-required",
        detail: "下書きの保存には会員登録が必要です。",
        error: "REGISTER_REQUIRED",
      });
    }
    if (ctx.role !== "OWNER") {
      throw new ProblemDetailException({
        status: 403,
        title: "Forbidden",
        detail: "下書きの保存は筆頭幹事（オーナー）の会員だけが行えます。",
      });
    }

    const input = SaveEventDraftSchema.parse(await req.json());
    assertDraftSaveStatus(input.status);

    const event = await saveEventDraft(params.id, input, input.flyerDraftKey);
    return NextResponse.json({ event: serializeEvent(event) });
  } catch (error) {
    return toErrorResponse(error, `/api/v1/organizer/events/${params.id}/draft`);
  }
}
