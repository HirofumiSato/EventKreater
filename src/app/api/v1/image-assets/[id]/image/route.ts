import { NextRequest, NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/http";
import {
  IMAGE_ASSET_CONTENT_TYPE,
  assertImageAssetId,
  readImageAssetFile,
} from "@/lib/image-assets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: { id: string };
}

/**
 * 会員が上げた画像（プロフィールのアイコンなど）。
 *
 * ID は差し替えのたびに新しくなるので、内容は変わらない。
 * 1 年キャッシュを許し、CDN 越しでも都度 DB を引かない。
 */
export async function GET(_req: NextRequest, { params }: RouteContext) {
  try {
    const id = assertImageAssetId(params.id);
    const bytes = await readImageAssetFile(id);
    return new NextResponse(new Uint8Array(bytes), {
      headers: {
        "Content-Type": IMAGE_ASSET_CONTENT_TYPE,
        "Cache-Control": "public, max-age=31536000, immutable",
        "X-Content-Type-Options": "nosniff",
        "Content-Length": String(bytes.byteLength),
      },
    });
  } catch (error) {
    return toErrorResponse(error, `/api/v1/image-assets/${params.id}/image`);
  }
}
