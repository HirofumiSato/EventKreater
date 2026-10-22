import { NextRequest, NextResponse } from "next/server";
import { resolveAuthContext, resolveOptionalUserId } from "@/modules/auth/lib/guards";
import { toErrorResponse } from "@/lib/http";
import { acceptInvitation, previewInvitation } from "@/modules/organizers/lib/invitations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: { code: string };
}

export async function GET(req: NextRequest, { params }: RouteContext) {
  try {
    const preview = await previewInvitation(params.code);
    // 共同主催は会員だけが受諾できる。画面はこの値で、受諾ボタンと登録の導線を出し分ける。
    const userId = await resolveOptionalUserId(req);
    return NextResponse.json({ ...preview, loggedIn: Boolean(userId) });
  } catch (error) {
    return toErrorResponse(error, `/api/v1/invitations/${params.code}`);
  }
}

export async function POST(req: NextRequest, { params }: RouteContext) {
  try {
    const identity = await resolveAuthContext(req);
    // 未登録の端末は 403 REGISTER_REQUIRED。Cookie での幹事権限は発行しない。
    const result = await acceptInvitation(params.code, identity);
    return NextResponse.json(result);
  } catch (error) {
    return toErrorResponse(error, `/api/v1/invitations/${params.code}`);
  }
}
