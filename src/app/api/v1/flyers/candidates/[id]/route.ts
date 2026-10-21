import { NextRequest, NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/http";
import { readCandidateImage } from "@/modules/flyers/lib/flyer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: { id: string };
}

/** 候補画像。ブラウザは 8000 番に届かないので、必ずここを経由させる。 */
export async function GET(_req: NextRequest, { params }: RouteContext) {
  try {
    const bytes = await readCandidateImage(params.id);
    return new NextResponse(new Uint8Array(bytes), {
      headers: {
        "Content-Type": "image/jpeg",
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch (error) {
    return toErrorResponse(error, `/api/v1/flyers/candidates/${params.id}`);
  }
}
