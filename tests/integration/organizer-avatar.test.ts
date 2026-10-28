import { afterEach, describe, expect, it } from "vitest";
import { rm } from "fs/promises";
import path from "path";
import { NextRequest } from "next/server";
import sharp from "sharp";
import { prisma } from "@/lib/prisma";
import { resetUploadAttempts } from "@/lib/upload-limit";
import { signLocalToken } from "@/modules/auth/lib/auth";
import { DELETE as deleteAvatar, POST as postAvatar } from "@/app/api/v1/organizer/profile/avatar/route";
import { GET as getImageAsset } from "@/app/api/v1/image-assets/[id]/image/route";
import { GET as getPublicProfile } from "@/app/api/v1/public/organizers/[userId]/route";
import { cleanup, seedEvent, uniqueEmail } from "./helpers";

if (!process.env.JWT_SECRET) {
  process.env.JWT_SECRET = "integration-test-secret-key-0123456789";
}

const describeDb = process.env.TEST_DATABASE_URL ? describe : describe.skip;

const IMAGE_DIR = path.join(process.cwd(), "storage", "images");

/** 縦横比の違う画像を用意し、中央で正方形に切り抜かれることを確かめられるようにする。 */
async function samplePng(width = 600, height = 400): Promise<Buffer> {
  return sharp({
    create: { width, height, channels: 3, background: { r: 200, g: 80, b: 40 } },
  })
    .png()
    .toBuffer();
}

function uploadRequest(token: string, bytes: Buffer, name = "avatar.png") {
  const form = new FormData();
  form.append("file", new File([new Uint8Array(bytes)], name, { type: "image/png" }));
  return new NextRequest("http://localhost/api/v1/organizer/profile/avatar", {
    method: "POST",
    ...(token ? { headers: { cookie: `auth_token=${token}` } } : {}),
    body: form,
  });
}

function authRequest(method: "DELETE", token?: string) {
  return new NextRequest("http://localhost/api/v1/organizer/profile/avatar", {
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

/** アイコンの URL から `image_assets.id` を取り出す。 */
function assetIdOf(avatarUrl: string | null): string {
  const match = avatarUrl?.match(/\/api\/v1\/image-assets\/([0-9a-f-]{36})\/image$/i);
  if (!match) throw new Error(`avatarUrl の形が想定と違います: ${avatarUrl ?? "null"}`);
  return match[1];
}

describeDb("主催者のアイコン画像（結合）", () => {
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
      data: { email: uniqueEmail("organizer-avatar"), name: label },
    });
    userIds.push(organizer.id);
    const event = await seedEvent({ userId: organizer.id, role: "OWNER" });
    eventIds.push(event.id);
    const token = await signLocalToken({ userId: organizer.id, email: organizer.email });
    return { organizer, token };
  }

  it("PNG を上げると WebP の 256px 角になって保存される", async () => {
    const { organizer, token } = await createOrganizer("アイコンを上げる主催者");

    const response = await postAvatar(uploadRequest(token, await samplePng()));
    expect(response.status).toBe(201);
    const body = (await response.json()) as { avatarUrl: string };
    const id = assetIdOf(body.avatarUrl);
    assetIds.push(id);

    const row = await prisma.imageAsset.findUnique({ where: { id } });
    expect(row).toMatchObject({
      userId: organizer.id,
      kind: "AVATAR",
      contentType: "image/webp",
      isDeleted: false,
    });
    expect(row?.byteSize).toBeGreaterThan(0);

    const profile = await prisma.organizerProfile.findUnique({ where: { userId: organizer.id } });
    expect(profile?.avatarImageId).toBe(id);

    const image = await fetchImage(id);
    expect(image.status).toBe(200);
    expect(image.contentType).toBe("image/webp");
    expect(image.cacheControl).toContain("immutable");
    const meta = await sharp(image.bytes).metadata();
    expect(meta.format).toBe("webp");
    expect(meta.width).toBe(256);
    expect(meta.height).toBe(256);
  });

  it("公開プロフィールの応答にアイコンの URL が入る", async () => {
    const { organizer, token } = await createOrganizer("アイコンを出す主催者");
    await prisma.organizerProfile.create({
      data: { userId: organizer.id, isPublished: true, headline: "読書会" },
    });

    const response = await postAvatar(uploadRequest(token, await samplePng()));
    const body = (await response.json()) as { avatarUrl: string };
    assetIds.push(assetIdOf(body.avatarUrl));

    const publicResponse = await getPublicProfile(
      new NextRequest(`http://localhost/api/v1/public/organizers/${organizer.id}`),
      { params: { userId: organizer.id } },
    );
    const publicBody = (await publicResponse.json()) as { profile: { avatarUrl: string | null } };

    expect(publicBody.profile.avatarUrl).toBe(body.avatarUrl);
  });

  it("差し替えると古い画像は配信を止める", async () => {
    const { token } = await createOrganizer("アイコンを替える主催者");

    const first = (await (await postAvatar(uploadRequest(token, await samplePng()))).json()) as {
      avatarUrl: string;
    };
    const firstId = assetIdOf(first.avatarUrl);
    assetIds.push(firstId);

    const second = (await (await postAvatar(uploadRequest(token, await samplePng(300, 300)))).json()) as {
      avatarUrl: string;
    };
    const secondId = assetIdOf(second.avatarUrl);
    assetIds.push(secondId);
    expect(secondId).not.toBe(firstId);

    expect((await fetchImage(firstId)).status).toBe(404);
    expect((await fetchImage(secondId)).status).toBe(200);
  });

  it("削除すると参照が外れ、画像も 404 になる", async () => {
    const { organizer, token } = await createOrganizer("アイコンを消す主催者");
    const created = (await (await postAvatar(uploadRequest(token, await samplePng()))).json()) as {
      avatarUrl: string;
    };
    const id = assetIdOf(created.avatarUrl);
    assetIds.push(id);

    const response = await deleteAvatar(authRequest("DELETE", token));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ avatarUrl: null });

    const profile = await prisma.organizerProfile.findUnique({ where: { userId: organizer.id } });
    expect(profile?.avatarImageId).toBeNull();
    expect((await fetchImage(id)).status).toBe(404);
  });

  it("画像でないファイルは 422 で弾き、行も残さない", async () => {
    const { organizer, token } = await createOrganizer("画像でない物を上げる主催者");

    const response = await postAvatar(uploadRequest(token, Buffer.from("これは画像ではありません")));

    expect(response.status).toBe(422);
    const rows = await prisma.imageAsset.findMany({ where: { userId: organizer.id } });
    expect(rows).toHaveLength(0);
  });

  it("4MB を超える画像は 413 で弾く", async () => {
    const { token } = await createOrganizer("大きい画像を上げる主催者");

    // 中身は PNG のまま、末尾を 0 で埋めて 4MB を超えさせる。
    const bytes = Buffer.concat([await samplePng(), Buffer.alloc(4 * 1024 * 1024)]);
    const response = await postAvatar(uploadRequest(token, bytes));

    expect(response.status).toBe(413);
  });

  it("未ログインでは上げられない", async () => {
    const response = await postAvatar(uploadRequest("", await samplePng()));

    expect(response.status).toBe(401);
  });

  it("形が UUID でない画像 URL は 404", async () => {
    const image = await fetchImage("not-a-uuid");

    expect(image.status).toBe(404);
  });
});
