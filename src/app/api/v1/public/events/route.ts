import { NextRequest, NextResponse } from "next/server";
import { generateSecureToken, sha256 } from "@/lib/crypto";
import { collectGuestTokenHashes, resolveUserId } from "@/modules/auth/lib/guards";
import { toErrorResponse } from "@/lib/http";
import { CreateEventSchema } from "@/lib/schemas";
import { createdEventBody, createEventForGuest, createEventForUser } from "@/modules/events/lib/events";
import { assertGuestCanCreate } from "@/modules/events/lib/guest-limit";
import {
  rememberVenueQuietly,
  writeVenueOwnerCookie,
} from "@/modules/events/lib/venue-suggestions";
import { ORGANIZER_MAX_AGE, organizerCookieName, writeCookie } from "@/modules/auth/lib/cookies";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// イベントの一覧・検索は提供しない。告知は主催者が共有した URL からだけ開く。
// 将来のメディアサイトは、このアプリの DB と GET /api/v1/public/events/[id] を読む別サービスとして足す。

export async function POST(req: NextRequest) {
  try {
    const json = await req.json();
    const input = CreateEventSchema.parse(json);
    const userId = await resolveUserId(req);

    if (userId) {
      const created = await createEventForUser(userId, input);
      const response = NextResponse.json(
        createdEventBody(created.event, created.guestOrganizerToken),
        { status: 201 },
      );
      const venueCookie = await rememberVenueQuietly(req, input);
      writeVenueOwnerCookie(response, req, venueCookie);
      return response;
    }

    await assertGuestCanCreate(collectGuestTokenHashes(req));
    const guestOrganizerToken = generateSecureToken(32);
    const event = await createEventForGuest(input, sha256(guestOrganizerToken));
    const response = NextResponse.json(createdEventBody(event, guestOrganizerToken), {
      status: 201,
    });
    writeCookie(
      response,
      req,
      organizerCookieName(event.id),
      guestOrganizerToken,
      ORGANIZER_MAX_AGE,
    );
    // 未登録の幹事には、入力した会場をこの端末の候補として覚えるための Cookie も渡す。
    const venueCookie = await rememberVenueQuietly(req, input);
    writeVenueOwnerCookie(response, req, venueCookie);
    return response;
  } catch (error) {
    return toErrorResponse(error, "/api/v1/public/events");
  }
}
