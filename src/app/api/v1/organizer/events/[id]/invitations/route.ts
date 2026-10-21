import { NextRequest, NextResponse } from "next/server";
import { assertRegisteredOwner } from "@/modules/auth/lib/guards";
import { toErrorResponse } from "@/lib/http";
import { createInvitation } from "@/modules/organizers/lib/invitations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: { id: string };
}

export async function POST(req: NextRequest, { params }: RouteContext) {
  try {
    await assertRegisteredOwner(req, params.id);
    const invitation = await createInvitation(params.id);
    return NextResponse.json(invitation, { status: 201 });
  } catch (error) {
    return toErrorResponse(error, `/api/v1/organizer/events/${params.id}/invitations`);
  }
}
