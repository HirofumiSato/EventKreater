import { afterEach, describe, expect, it } from "vitest";
import { rm } from "fs/promises";
import path from "path";
import { NextRequest } from "next/server";
import sharp from "sharp";
import { prisma } from "@/lib/prisma";
import { resetUploadAttempts } from "@/lib/upload-limit";
import { signLocalToken } from "@/modules/auth/lib/auth";
import { DELETE as deleteHeader, POST as postHeader } from "@/app/api/v1/organizer/profile/header/route";
import { GET as getImageAsset } from "@/app/api/v1/image-assets/[id]/image/route";
import { GET as getPublicProfile } from "@/app/api/v1/public/organizers/[userId]/route";
import { cleanup, seedEvent, uniqueEmail } from "./helpers";

if (!process.env.JWT_SECRET) {
  process.env.JWT_SECRET = "integration-test-secret-key-0123456789";
}

const describeDb = process.env.TEST_DATABASE_URL ? describe : describe.skip;

const IMAGE_DIR = path.join(process.cwd(), "storage", "images");

/** ヘッダーの上限（8MB）。超える大きさを作るために同じ値を持つ。 */
const MAX_HEADER_BYTES = 8 * 1024 * 1024;

/**
 * 3:1 より横長の画像を用意し、中央で 1920x640 に切り抜かれることを確かめられるようにする。
 * 既定は 1200x800（3:2）で、最小幅 800px も満たす。
 */
async function samplePng(width = 1200, height = 800): Promise<Buffer> {
  return sharp({
    create: { width, height, channels: 3, background: { r: 40, g: 120, b: 200 } },
  })
    .png()
    .toBuffer();
}

function uploadRequest(token: string, bytes: Buffer, name = "header.png") {
  const form = new FormData();
  form.append("file", new File([new Uint8Array(bytes)], name, { type: "image/png" }));
  return new NextRequest("http://localhost/api/v1/organizer/profile/header", {
    method: "POST",
    ...(token ? { headers: { cookie: `auth_token=${token}` } } : {}),
    body: form,
  });
}

function authRequest(method: "DELETE", token?: string) {
  return new NextRequest("http://localhost/api/v1/organizer/profile/header", {
    method,
    headers: token ? { cookie: `auth_token=${token}` } : {},
  });
}

async function fetchImage(id: string) {
  const response = await getImageAsset(
    new NextRequest(`http://localhost/api/v1/image-assets/${id}/image`),
    { params: { id } },
  );
  return {
    status: response.status,
    contentType: response.headers.get("content-type"),
    cacheControl: response.headers.get("cache-control"),
    bytes: Buffer.from(await response.arrayBuffer()),
  };
}

/** ヘッダーの URL から `image_assets.id` を取り出す。 */
function assetIdOf(headerUrl: string | null): string {
  const match = headerUrl?.match(/\/api\/v1\/image-assets\/([0-9a-f-]{36})\/image$/i);
  if (!match) throw new Error(`headerUrl の形が想定と違います: ${headerUrl ?? "null"}`);
  return match[1];
}

describeDb("主催者のヘッダー画像（結合）", () => {
  const eventIds: string[] = [];
  const userIds: string[] = [];
  const assetIds: string[] = [];

  afterEach(async () => {
    resetUploadAttempts();
    if (assetIds.length > 0) {
      // 画像は会員と独立して残る（user_id は ON DELETE SET NULL）。行もファイルも片付ける。
      await prisma.imageAsset.deleteMany({ where: { id: { in: assetIds } } });
      await Promise.all(assetIds.map((id) => rm(path.join(IMAGE_DIR, `${id}.webp`), { force: true })));
    }
    await cleanup({ eventIds, userIds });
    eventIds.length = 0;
    userIds.length = 0;
    assetIds.length = 0;
  });

  async function createOrganizer(label: string) {
    const organizer = await prisma.user.create({
      data: { email: uniqueEmail("organizer-header"), name: label },
    });
    userIds.push(organizer.id);
    const event = await seedEvent({ userId: organizer.id, role: "OWNER" });
    eventIds.push(event.id);
    const token = await signLocalToken({ userId: organizer.id, email: organizer.email });
    return { organizer, token };
  }

  it("PNG を上げると WebP の 1920x640 になって保存される", async () => {
    const { organizer, token } = await createOrganizer("ヘッダーを上げる主催者");

    const response = await postHeader(uploadRequest(token, await samplePng()));
    expect(response.status).toBe(201);
    const body = (await response.json()) as { headerUrl: string };
    const id = assetIdOf(body.headerUrl);
    assetIds.push(id);

    const row = await prisma.imageAsset.findUnique({ where: { id } });
    expect(row).toMatchObject({
      userId: organizer.id,
      kind: "PROFILE_HEADER",
      contentType: "image/webp",
      width: 1920,
      height: 640,
      isDeleted: false,
    });
    expect(row?.byteSize).toBeGreaterThan(0);

    const profile = await prisma.organizerProfile.findUnique({ where: { userId: organizer.id } });
    expect(profile?.headerImageId).toBe(id);

    const image = await fetchImage(id);
    expect(image.status).toBe(200);
    expect(image.contentType).toBe("image/webp");
    expect(image.cacheControl).toContain("immutable");
    const meta = await sharp(image.bytes).metadata();
    expect(meta.format).toBe("webp");
    expect(meta.width).toBe(1920);
    expect(meta.height).toBe(640);
  });

  it("公開プロフィールの応答にヘッダーの URL が入り、非公開にすると消える", async () => {
    const { organizer, token } = await createOrganizer("ヘッダーを出す主催者");
    await prisma.organizerProfile.create({
      data: { userId: organizer.id, isPublished: true, headline: "読書会" },
    });

    const response = await postHeader(uploadRequest(token, await samplePng()));
    const body = (await response.json()) as { headerUrl: string };
    assetIds.push(assetIdOf(body.headerUrl));

    const publicResponse = await getPublicProfile(
      new NextRequest(`http://localhost/api/v1/public/organizers/${organizer.id}`),
      { params: { userId: organizer.id } },
    );
    const publicBody = (await publicResponse.json()) as {
      profile: { isPublished: boolean; headerUrl: string | null };
    };

    expect(publicBody.profile.headerUrl).toBe(body.headerUrl);

    await prisma.organizerProfile.update({
      where: { userId: organizer.id },
      data: { isPublished: false },
    });

    const hiddenResponse = await getPublicProfile(
      new NextRequest(`http://localhost/api/v1/public/organizers/${organizer.id}`),
      { params: { userId: organizer.id } },
    );
    const hiddenBody = (await hiddenResponse.json()) as {
      profile: { isPublished: boolean; headerUrl: string | null };
    };

    expect(hiddenBody.profile.isPublished).toBe(false);
    expect(hiddenBody.profile.headerUrl).toBeNull();
  });

  it("差し替えると古い画像は配信を止める", async () => {
    const { organizer, token } = await createOrganizer("ヘッダーを替える主催者");

    const first = (await (await postHeader(uploadRequest(token, await samplePng()))).json()) as {
      headerUrl: string;
    };
    const firstId = assetIdOf(first.headerUrl);
    assetIds.push(firstId);

    const second = (
      await (await postHeader(uploadRequest(token, await samplePng(1000, 500)))).json()
    ) as { headerUrl: string };
    const secondId = assetIdOf(second.headerUrl);
    assetIds.push(secondId);
    expect(secondId).not.toBe(firstId);

    expect((await fetchImage(firstId)).status).toBe(404);
    expect((await fetchImage(secondId)).status).toBe(200);

    const profile = await prisma.organizerProfile.findUnique({ where: { userId: organizer.id } });
    expect(profile?.headerImageId).toBe(secondId);
  });

  it("削除すると参照が外れ、画像も 404 になる", async () => {
    const { organizer, token } = await createOrganizer("ヘッダーを消す主催者");
    const created = (await (await postHeader(uploadRequest(token, await samplePng()))).json()) as {
      headerUrl: string;
    };
    const id = assetIdOf(created.headerUrl);
    assetIds.push(id);

    const response = await deleteHeader(authRequest("DELETE", token));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ headerUrl: null });

    const profile = await prisma.organizerProfile.findUnique({ where: { userId: organizer.id } });
    expect(profile?.headerImageId).toBeNull();
    expect((await fetchImage(id)).status).toBe(404);
  });

  it("横 800px に満たない画像は 422 で弾き、行も残さない", async () => {
    const { organizer, token } = await createOrganizer("小さい画像を上げる主催者");

    // 600x200 は 3:1 でも、幅が 800px に届かない。
    const response = await postHeader(uploadRequest(token, await samplePng(600, 200)));

    expect(response.status).toBe(422);
    const body = (await response.json()) as { error: string };
    expect(body.error).toBe("IMAGE_TOO_SMALL");

    const rows = await prisma.imageAsset.findMany({ where: { userId: organizer.id } });
    expect(rows).toHaveLength(0);
    const profile = await prisma.organizerProfile.findUnique({ where: { userId: organizer.id } });
    expect(profile?.headerImageId ?? null).toBeNull();
  });

  it("画像でないファイルは 422 で弾き、行も残さない", async () => {
    const { organizer, token } = await createOrganizer("画像でない物を上げる主催者");

    const response = await postHeader(uploadRequest(token, Buffer.from("これは画像ではありません")));

    expect(response.status).toBe(422);
    const body = (await response.json()) as { error: string };
    expect(body.error).toBe("INVALID_IMAGE");

    const rows = await prisma.imageAsset.findMany({ where: { userId: organizer.id } });
    expect(rows).toHaveLength(0);
  });

  it("8MB を超える画像は 413 で弾く", async () => {
    const { token } = await createOrganizer("大きい画像を上げる主催者");

    // 中身は PNG のまま、末尾を 0 で埋めて 8MB を超えさせる。
    const bytes = Buffer.concat([await samplePng(), Buffer.alloc(MAX_HEADER_BYTES)]);
    const response = await postHeader(uploadRequest(token, bytes));

    expect(response.status).toBe(413);
  });

  it("未ログインでは上げられない", async () => {
    const response = await postHeader(uploadRequest("", await samplePng()));

    expect(response.status).toBe(401);
  });

  it("形が UUID でない画像 URL は 404", async () => {
    const image = await fetchImage("not-a-uuid");

    expect(image.status).toBe(404);
  });
});
