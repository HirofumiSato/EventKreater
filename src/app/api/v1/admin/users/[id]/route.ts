import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/modules/auth/lib/guards";
import { updatePlatformRole } from "@/modules/admin/lib/directory";
import { ProblemDetailException } from "@/lib/exceptions";
import { toErrorResponse } from "@/lib/http";
import { AdminRoleSchema } from "@/lib/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const admin = await requireAdmin(req);
    if (!UUID.test(params.id)) {
      throw new ProblemDetailException({
        status: 404,
        title: "Not Found",
        detail: "会員が見つかりません。",
      });
    }
    const input = AdminRoleSchema.parse(await req.json());
    const user = await updatePlatformRole(admin.id, params.id, input.platformRole);
    return NextResponse.json({ user });
  } catch (error) {
    return toErrorResponse(error, `/api/v1/admin/users/${params.id}`);
  }
}
