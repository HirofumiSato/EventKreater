import { NextRequest, NextResponse } from "next/server";
import { ProblemDetailException } from "@/lib/exceptions";
import { toErrorResponse } from "@/lib/http";
import { createImageAsset, retireImageAsset } from "@/lib/image-assets";
import { MAX_HEADER_BYTES, detectImageKind } from "@/lib/image-upload";
import { consumeUploadAttempt } from "@/lib/upload-limit";
import { requireOrganizerAccount } from "@/modules/auth/lib/guards";
import {
  assertOrganizerMember,
  clearOrganizerHeader,
  readOrganizerHeaderId,
  readOrganizerHeaderUrl,
  setOrganizerHeader,
} from "@/modules/organizers/lib/profile-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NOT_FOUND = "/api/v1/organizer/profile/header";

/**
 * 公開プロフィールのヘッダー画像（SCR-ORG-14）。
 *
 * アイコンと同じく「選んだ時点で反映」する。本文（肩書き・自己紹介）の保存とは
 * 分けることで、本文の保存に失敗しても画像だけ巻き戻る事故を作らない。
 *
 * 保存するのは 1920x640 の WebP。画面側で 3:1 に切り出して送るが、
 * 比がずれた画像でも崩れないよう、サーバー側でも中央で切り抜き直す。
 */
export async function POST(req: NextRequest) {
  let createdId: string | null = null;
  try {
    const userId = await requireOrganizerAccount(req);
    await assertOrganizerMember(userId);

    const declared = Number(req.headers.get("content-length") ?? "0");
    if (declared > MAX_HEADER_BYTES + 1024 * 1024) {
      throw new ProblemDetailException({
        status: 413,
        title: "Payload Too Large",
        type: "probs/upload-too-large",
        detail: "ヘッダー画像は8MB以下にしてください。",
      });
    }

    let form: FormData;
    try {
      form = await req.formData();
    } catch {
      throw new ProblemDetailException({
        status: 400,
        title: "Validation Error",
        detail: "画像を送信できませんでした。選び直してください。",
      });
    }

    const file = form.get("file");
    if (!(file instanceof File) || file.size === 0) {
      throw new ProblemDetailException({
        status: 400,
        title: "Validation Error",
        detail: "ヘッダーにする画像を選んでください。",
      });
    }
    if (file.size > MAX_HEADER_BYTES) {
      throw new ProblemDetailException({
        status: 413,
        title: "Payload Too Large",
        type: "probs/upload-too-large",
        detail: "ヘッダー画像は8MB以下にしてください。",
      });
    }

    const bytes = Buffer.from(await file.arrayBuffer());
    const kind = detectImageKind(bytes);
    if (!kind) {
      throw new ProblemDetailException({
        status: 422,
        title: "Validation Error",
        type: "probs/validation-error",
        error: "INVALID_IMAGE",
        detail: "JPEG / PNG / WebP の画像を選んでください。",
      });
    }

    consumeUploadAttempt(`header:${userId}`);

    const previousId = await readOrganizerHeaderId(userId);
    const created = await createImageAsset({ userId, kind: "PROFILE_HEADER", bytes });
    createdId = created.id;
    await setOrganizerHeader(userId, created.id);
    // ここから先で失敗しても、新しい画像は参照済み。消してはいけない。
    createdId = null;
    // 参照を移したあとで退役させる。先に消すと、失敗したときにヘッダーが消えたままになる。
    if (previousId && previousId !== created.id) {
      await retireImageAsset(previousId).catch(() => undefined);
    }

    return NextResponse.json(
      { headerUrl: await readOrganizerHeaderUrl(userId) },
      { status: 201 },
    );
  } catch (error) {
    // DB の更新に失敗した画像は、配信 URL を持たないまま残さない。
    if (createdId) await retireImageAsset(createdId).catch(() => undefined);
    return toErrorResponse(error, NOT_FOUND);
  }
}

/** ヘッダー画像を外す。以後は画像無しの見た目に戻る。 */
export async function DELETE(req: NextRequest) {
  try {
    const userId = await requireOrganizerAccount(req);
    await assertOrganizerMember(userId);
    const previousId = await clearOrganizerHeader(userId);
    await retireImageAsset(previousId);
    return NextResponse.json({ headerUrl: null });
  } catch (error) {
    return toErrorResponse(error, NOT_FOUND);
  }
}
