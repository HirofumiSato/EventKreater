import { NextRequest, NextResponse } from "next/server";
import { ProblemDetailException } from "@/lib/exceptions";
import { toErrorResponse } from "@/lib/http";
import { createImageAsset, retireImageAsset } from "@/lib/image-assets";
import { MAX_AVATAR_BYTES, detectImageKind } from "@/lib/image-upload";
import { consumeUploadAttempt } from "@/lib/upload-limit";
import { requireOrganizerAccount } from "@/modules/auth/lib/guards";
import {
  assertOrganizerMember,
  clearOrganizerAvatar,
  readOrganizerAvatarId,
  readOrganizerAvatarUrl,
  setOrganizerAvatar,
} from "@/modules/organizers/lib/profile-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NOT_FOUND = "/api/v1/organizer/profile/avatar";

/**
 * 公開プロフィールのアイコン（SCR-ORG-14）。
 *
 * 本文（肩書き・自己紹介）の保存とは分ける。画像は「選んだ時点で反映」したほうが
 * 分かりやすく、本文の保存に失敗してもアイコンだけ巻き戻る事故が無いため。
 *
 * 保存するのは WebP に作り直した 256px 角。原本は置かない。
 */
export async function POST(req: NextRequest) {
  let createdId: string | null = null;
  try {
    const userId = await requireOrganizerAccount(req);
    await assertOrganizerMember(userId);

    const declared = Number(req.headers.get("content-length") ?? "0");
    if (declared > MAX_AVATAR_BYTES + 1024 * 1024) {
      throw new ProblemDetailException({
        status: 413,
        title: "Payload Too Large",
        type: "probs/upload-too-large",
        detail: "アイコン画像は4MB以下にしてください。",
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
        detail: "アイコンにする画像を選んでください。",
      });
    }
    if (file.size > MAX_AVATAR_BYTES) {
      throw new ProblemDetailException({
        status: 413,
        title: "Payload Too Large",
        type: "probs/upload-too-large",
        detail: "アイコン画像は4MB以下にしてください。",
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

    consumeUploadAttempt(`avatar:${userId}`);

    const previousId = await readOrganizerAvatarId(userId);
    const created = await createImageAsset({ userId, kind: "AVATAR", bytes });
    createdId = created.id;
    await setOrganizerAvatar(userId, created.id);
    // ここから先で失敗しても、新しい画像は参照済み。消してはいけない。
    createdId = null;
    // 参照を移したあとで退役させる。先に消すと、失敗したときにアイコンが消えたままになる。
    if (previousId && previousId !== created.id) {
      await retireImageAsset(previousId).catch(() => undefined);
    }

    return NextResponse.json(
      { avatarUrl: await readOrganizerAvatarUrl(userId) },
      { status: 201 },
    );
  } catch (error) {
    // DB の更新に失敗した画像は、配信 URL を持たないまま残さない。
    if (createdId) await retireImageAsset(createdId).catch(() => undefined);
    return toErrorResponse(error, NOT_FOUND);
  }
}

/** アイコンを外す。以後は名前の頭文字に戻る。 */
export async function DELETE(req: NextRequest) {
  try {
    const userId = await requireOrganizerAccount(req);
    await assertOrganizerMember(userId);
    const previousId = await clearOrganizerAvatar(userId);
    await retireImageAsset(previousId);
    return NextResponse.json({ avatarUrl: null });
  } catch (error) {
    return toErrorResponse(error, NOT_FOUND);
  }
}
