import { NextRequest, NextResponse } from "next/server";
import { readFlyerImage } from "@/modules/flyers/lib/flyer";
import { toErrorResponse } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: { id: string };
}

export async function GET(_req: NextRequest, { params }: RouteContext) {
  try {
    const bytes = await readFlyerImage(params.id);
    return new NextResponse(new Uint8Array(bytes), {
      headers: {
        "Content-Type": "image/jpeg",
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  } catch (error) {
    return toErrorResponse(error, `/api/v1/flyer-assets/${params.id}/image`);
  }
}
