import { randomUUID } from "crypto";
import { mkdir, readFile, rm, writeFile } from "fs/promises";
import path from "path";
import sharp from "sharp";
import { ProblemDetailException } from "@/lib/exceptions";
import { prisma } from "@/lib/prisma";

/**
 * 会員が上げた画像の保存と配信。
 *
 * 保存する前に必ず WebP へ作り直す。原本をそのまま置くと、数十 MB の JPEG が
 * そのまま公開 URL に乗り、変換もできなくなるため。画面に出す大きさへ縮めてから置く。
 *
 * バイト列は `storage/images/{id}.webp` に、行は `image_assets` に持つ。
 * 公開 URL は `/api/v1/image-assets/{id}/image`。ID は不変なので、
 * 差し替えは「新しい行を作り、参照を付け替える」で行う（キャッシュも壊れない）。
 */

/** 用途。DB の列挙型にはせず、ここで検証する。 */
export const IMAGE_ASSET_KINDS = ["AVATAR", "EVENT_COVER"] as const;
export type ImageAssetKind = (typeof IMAGE_ASSET_KINDS)[number];

/** アイコンの一辺。画面では 64px で出す。高解像度の端末でも 2 倍で足りる。 */
export const AVATAR_SIZE = 256;

/** 元画像がこれより小さくても、ここまでは引き伸ばして正方形を揃える。 */
export const MIN_AVATAR_SIZE = 64;

/** 表紙（将来のイベント公開ページ）の幅。高さは原本の比に任せる。 */
export const COVER_WIDTH = 1200;

/** 保存する形式。いまは WebP だけ。 */
export const IMAGE_ASSET_CONTENT_TYPE = "image/webp";

/** 元画像の画素数上限。展開してから巨大な画像で詰まらないようにする。 */
const MAX_INPUT_PIXELS = 25_000_000;

const IMAGE_ASSET_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function storageDir(): string {
  return path.join(process.cwd(), "storage", "images");
}

function imagePath(id: string): string {
  return path.join(storageDir(), `${assertImageAssetId(id)}.webp`);
}

export function assertImageAssetId(id: string): string {
  if (!IMAGE_ASSET_ID.test(id)) {
    throw new ProblemDetailException({
      status: 404,
      title: "Not Found",
      detail: "画像が見つかりません。",
    });
  }
  return id;
}

/** 公開 URL。`image_assets.id` から決まる。 */
export function imageAssetImagePath(id: string): string {
  return `/api/v1/image-assets/${id}/image`;
}

export interface CreateImageAssetInput {
  userId: string;
  kind: ImageAssetKind;
  /** 受け取った原本。形式の判定は呼び出し側で済ませておく。 */
  bytes: Buffer;
}

export interface CreatedImageAsset {
  id: string;
  width: number;
  height: number;
  byteSize: number;
}

interface TransformResult {
  data: Buffer;
  width: number;
  height: number;
}

/** 用途ごとの縮め方。アイコンは中央で正方形に切り抜き、表紙は幅だけを揃える。 */
async function transform(bytes: Buffer, kind: ImageAssetKind): Promise<TransformResult> {
  const base = sharp(bytes, { limitInputPixels: MAX_INPUT_PIXELS, failOn: "error" }).rotate();

  if (kind === "AVATAR") {
    // 元の短い辺より大きくしない。拡大すると眠い画像になり、保存サイズだけが増える。
    const meta = await base.metadata();
    const swap = meta.orientation !== undefined && meta.orientation >= 5;
    const shortSide = Math.min(
      swap ? (meta.height ?? 0) : (meta.width ?? 0),
      swap ? (meta.width ?? 0) : (meta.height ?? 0),
    );
    const size = Math.min(AVATAR_SIZE, Math.max(MIN_AVATAR_SIZE, shortSide || AVATAR_SIZE));
    const { data, info } = await base
      .resize(size, size, { fit: "cover", position: "centre" })
      .webp({ quality: 82 })
      .toBuffer({ resolveWithObject: true });
    return { data, width: info.width, height: info.height };
  }

  const { data, info } = await base
    .resize({ width: COVER_WIDTH, withoutEnlargement: true })
    .webp({ quality: 82 })
    .toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

/**
 * 画像を作り直して保存する。失敗したら行もファイルも残さない。
 * 変換に失敗した画像は 422（形式は合っているが中身が読めない）として扱う。
 */
export async function createImageAsset({
  userId,
  kind,
  bytes,
}: CreateImageAssetInput): Promise<CreatedImageAsset> {
  let transformed: TransformResult;
  try {
    transformed = await transform(bytes, kind);
  } catch {
    throw new ProblemDetailException({
      status: 422,
      title: "Validation Error",
      type: "probs/validation-error",
      error: "INVALID_IMAGE",
      detail: "画像を読み取れませんでした。別の画像を選んでください。",
    });
  }

  const id = randomUUID();
  await mkdir(storageDir(), { recursive: true });
  await writeFile(imagePath(id), transformed.data);

  try {
    await prisma.imageAsset.create({
      data: {
        id,
        userId,
        kind,
        contentType: IMAGE_ASSET_CONTENT_TYPE,
        width: transformed.width,
        height: transformed.height,
        byteSize: transformed.data.byteLength,
      },
    });
  } catch (error) {
    // 行が作れなかった画像は配信できない。置き去りにしない。
    await rm(imagePath(id), { force: true });
    throw error;
  }

  return {
    id,
    width: transformed.width,
    height: transformed.height,
    byteSize: transformed.data.byteLength,
  };
}

/** 配信するバイト列。論理削除済み・行が無い・ファイルが無いは、どれも 404。 */
export async function readImageAssetFile(id: string): Promise<Buffer> {
  assertImageAssetId(id);
  const row = await prisma.imageAsset.findFirst({
    where: { id, isDeleted: false },
    select: { id: true },
  });
  if (!row) {
    throw new ProblemDetailException({
      status: 404,
      title: "Not Found",
      detail: "画像が見つかりません。",
    });
  }
  try {
    return await readFile(imagePath(id));
  } catch {
    throw new ProblemDetailException({
      status: 404,
      title: "Not Found",
      detail: "画像が見つかりません。",
    });
  }
}

/**
 * 参照が外れた画像を退役させる。行は残し（監査と二重参照の確認のため）、
 * 配信を止めてファイルを消す。既に無いときは何もしない。
 */
export async function retireImageAsset(id: string | null | undefined): Promise<void> {
  if (!id) return;
  await prisma.imageAsset.updateMany({
    where: { id, isDeleted: false },
    data: { isDeleted: true },
  });
  if (!IMAGE_ASSET_ID.test(id)) return;
  await rm(imagePath(id), { force: true });
}
