import { NextRequest, NextResponse } from "next/server";
import { ORGANIZER_MAX_AGE, organizerCookieName, writeCookie } from "@/modules/auth/lib/cookies";
import { resolveAuthContext } from "@/modules/auth/lib/guards";
import { toErrorResponse } from "@/lib/http";
import { acceptInvitation, previewInvitation } from "@/modules/organizers/lib/invitations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: { code: string };
}

export async function GET(_req: NextRequest, { params }: RouteContext) {
  try {
    return NextResponse.json(await previewInvitation(params.code));
  } catch (error) {
    return toErrorResponse(error, `/api/v1/invitations/${params.code}`);
  }
}

export async function POST(req: NextRequest, { params }: RouteContext) {
  try {
    const identity = await resolveAuthContext(req);
    const result = await acceptInvitation(params.code, identity);
    const response = NextResponse.json(result);
    if (result.guestOrganizerToken) {
      writeCookie(
        response,
        req,
        organizerCookieName(result.eventId),
        result.guestOrganizerToken,
        ORGANIZER_MAX_AGE,
      );
    }
    return response;
  } catch (error) {
    return toErrorResponse(error, `/api/v1/invitations/${params.code}`);
  }
}
