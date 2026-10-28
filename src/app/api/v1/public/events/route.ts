import { NextRequest, NextResponse } from "next/server";
import { resolveUserId } from "@/modules/auth/lib/guards";
import { createdEventBody, createEventForUser } from "@/modules/events/lib/events";
import {
  rememberVenueQuietly,
  writeVenueOwnerCookie,
} from "@/modules/events/lib/venue-suggestions";
import { CreateEventSchema } from "@/lib/schemas";
import { ProblemDetailException } from "@/lib/exceptions";
import { toErrorResponse } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// イベントの一覧・検索は提供しない。告知は主催者が共有した URL からだけ開く。
// 未来のメディアサイトは、このアプリの DB と GET /api/v1/public/events/[id] を読む別サービスとして足す。
// 作成は会員だけが行える。未登録のまま作れると、出欠を見るのに結局登録が要るため、
// 作成画面は入力内容を退避してログインへ送る（src/modules/events/lib/pending-form.ts）。
export async function POST(req: NextRequest) {
  try {
    const userId = await resolveUserId(req);
    if (!userId) {
      throw new ProblemDetailException({
        status: 403,
        title: "Forbidden",
        type: "probs/register-required",
        detail: "イベントの作成には会員登録が必要です。",
        error: "REGISTER_REQUIRED",
      });
    }
    const json = await req.json();
    const input = CreateEventSchema.parse(json);
    const created = await createEventForUser(userId, input);
    const response = NextResponse.json(
      createdEventBody(created.event),
      { status: 201 },
    );
    const venueCookie = await rememberVenueQuietly(req, input);
    writeVenueOwnerCookie(response, req, venueCookie);
    return response;
  } catch (error) {
    return toErrorResponse(error, "/api/v1/public/events");
  }
}
