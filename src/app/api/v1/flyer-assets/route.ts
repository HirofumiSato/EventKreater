import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { toErrorResponse } from "@/lib/http";
import { serializeFlyer } from "@/lib/serializers";
import { flyerOwnerFilter } from "@/modules/flyers/lib/ownership";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const where = await flyerOwnerFilter(req);
    if (!where) {
      return NextResponse.json({ flyers: [] });
    }
    const flyers = await prisma.flyerAsset.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: 60,
    });
    return NextResponse.json({
      flyers: flyers.map((flyer) => serializeFlyer(flyer)),
    });
  } catch (error) {
    return toErrorResponse(error, "/api/v1/flyer-assets");
  }
}
