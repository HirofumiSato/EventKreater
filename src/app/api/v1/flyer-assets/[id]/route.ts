import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { ProblemDetailException } from "@/lib/exceptions";
import { toErrorResponse } from "@/lib/http";
import { flyerOwnerFilter } from "@/modules/flyers/lib/ownership";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: { id: string };
}

export async function DELETE(req: NextRequest, { params }: RouteContext) {
  try {
    const owner = await flyerOwnerFilter(req);
    if (!owner) {
      throw new ProblemDetailException({
        status: 404,
        title: "Not Found",
        detail: "チラシが見つかりません。",
      });
    }
    const asset = await prisma.flyerAsset.findFirst({
      where: { id: params.id, ...owner },
      select: { id: true },
    });
    if (!asset) {
      throw new ProblemDetailException({
        status: 404,
        title: "Not Found",
        detail: "チラシが見つかりません。",
      });
    }
    await prisma.flyerAsset.update({
      where: { id: asset.id },
      data: { isDeleted: true },
    });
    return NextResponse.json({ success: true });
  } catch (error) {
    return toErrorResponse(error, `/api/v1/flyer-assets/${params.id}`);
  }
}
