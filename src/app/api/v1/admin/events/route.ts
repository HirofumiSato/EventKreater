import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/modules/auth/lib/guards";
import { parseAdminListQuery, searchAdminEvents } from "@/modules/admin/lib/directory";
import { toErrorResponse } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    await requireAdmin(req);
    const { q, page, offset } = parseAdminListQuery(req.nextUrl.searchParams);
    const result = await searchAdminEvents(q, offset);
    return NextResponse.json({ ...result, q, page });
  } catch (error) {
    return toErrorResponse(error, "/api/v1/admin/events");
  }
}
