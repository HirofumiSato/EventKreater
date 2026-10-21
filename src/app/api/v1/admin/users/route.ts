import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/modules/auth/lib/guards";
import { parseAdminListQuery, searchAdminUsers } from "@/modules/admin/lib/directory";
import { toErrorResponse } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const admin = await requireAdmin(req);
    const { q, page, offset } = parseAdminListQuery(req.nextUrl.searchParams);
    const result = await searchAdminUsers(q, offset);
    return NextResponse.json({ ...result, q, page, actorId: admin.id });
  } catch (error) {
    return toErrorResponse(error, "/api/v1/admin/users");
  }
}
