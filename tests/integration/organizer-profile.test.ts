import { afterEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { signLocalToken } from "@/modules/auth/lib/auth";
import { GET as getPublicProfile } from "@/app/api/v1/public/organizers/[userId]/route";
import { GET as getOwnProfile, PUT as putOwnProfile } from "@/app/api/v1/organizer/profile/route";
import { cleanup, seedEvent, uniqueEmail } from "./helpers";

// JWT の署名鍵は本番と同じ長さを要求されるので、テスト用に満たしておく。
if (!process.env.JWT_SECRET) {
  process.env.JWT_SECRET = "integration-test-secret-key-0123456789";
}

const describeDb = process.env.TEST_DATABASE_URL ? describe : describe.skip;

async function createUser(name: string) {
  return prisma.user.create({ data: { email: uniqueEmail("organizer-profile"), name } });
}

async function addSchedule(eventId: string, date: string) {
  return prisma.eventSchedule.create({
    data: {
      eventId,
      eventDate: new Date(`${date}T00:00:00.000Z`),
      eventTime: "10:00",
      startTime: "10:00",
      endTime: "12:00",
      sortOrder: 0,
    },
  });
}

function ownRequest(token: string | null, method: "GET" | "PUT" = "GET", body?: unknown) {
  return new NextRequest("http://localhost/api/v1/organizer/profile", {
    method,
    headers: {
      ...(token ? { cookie: `auth_token=${token}` } : {}),
      ...(body ? { "content-type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}

async function callOwn(token: string | null, method: "GET" | "PUT" = "GET", body?: unknown) {
  const request = ownRequest(token, method, body);
  const response = method === "GET" ? await getOwnProfile(request) : await putOwnProfile(request);
  return { status: response.status, body: await response.json() };
}

async function callPublic(userId: string) {
  const response = await getPublicProfile(
    new NextRequest(`http://localhost/api/v1/public/organizers/${userId}`),
    { params: { userId } },
  );
  return { status: response.status, body: await response.json() };
}

describeDb("主催者の公開プロフィール（結合）", () => {
  const eventIds: string[] = [];
  const userIds: string[] = [];

  afterEach(async () => {
    await cleanup({ eventIds, userIds });
    eventIds.length = 0;
    userIds.length = 0;
  });

  it("未設定でも名前だけを返し、中身は出さない", async () => {
    const organizer = await createUser("未設定の主催者");
    userIds.push(organizer.id);
    const event = await seedEvent({ userId: organizer.id, role: "OWNER" });
    eventIds.push(event.id);

    const { status, body } = await callPublic(organizer.id);

    expect(status).toBe(200);
    expect(body).toMatchObject({
      userId: organizer.id,
      name: "未設定の主催者",
      profile: {
        isPublished: false,
        headline: null,
        bio: null,
        area: null,
        tags: [],
        links: [],
        stats: null,
      },
    });
  });

  it("保存した内容が公開ページに出る", async () => {
    const organizer = await createUser("公開する主催者");
    userIds.push(organizer.id);
    const event = await seedEvent({ userId: organizer.id, role: "OWNER" });
    eventIds.push(event.id);

    const token = await signLocalToken({ userId: organizer.id, email: organizer.email });
    const saved = await callOwn(token, "PUT", {
      isPublished: true,
      headline: "渋谷で読書会",
      bio: "月いちで開いています。",
      area: "東京都渋谷区",
      tags: ["LEARNING", "LOCAL"],
      xUrl: "https://x.com/example",
      instagramUrl: "",
      websiteUrl: "https://example.com",
      lineUrl: "",
      showStats: false,
    });

    expect(saved.status).toBe(200);
    expect(saved.body.profile.isPublished).toBe(true);

    const { body } = await callPublic(organizer.id);

    expect(body.profile).toMatchObject({
      isPublished: true,
      headline: "渋谷で読書会",
      bio: "月いちで開いています。",
      area: "東京都渋谷区",
      tags: ["LEARNING", "LOCAL"],
    });
    expect(body.profile.links.map((link: { kind: string }) => link.kind)).toEqual(["X"]);
  });

  it("非公開に戻すと、保存した内容も出さない", async () => {
    const organizer = await createUser("非公開に戻す主催者");
    userIds.push(organizer.id);
    const event = await seedEvent({ userId: organizer.id, role: "OWNER" });
    eventIds.push(event.id);

    const token = await signLocalToken({ userId: organizer.id, email: organizer.email });
    await callOwn(token, "PUT", { isPublished: true, headline: "いちど公開", bio: "本文" });
    await callOwn(token, "PUT", { isPublished: false, headline: "いちど公開", bio: "本文" });

    const { body } = await callPublic(organizer.id);

    expect(body.profile.isPublished).toBe(false);
    expect(body.profile.headline).toBeNull();
    expect(body.profile.bio).toBeNull();
  });

  it("保存は何度しても1行にまとまる", async () => {
    const organizer = await createUser("上書きする主催者");
    userIds.push(organizer.id);
    const event = await seedEvent({ userId: organizer.id, role: "OWNER" });
    eventIds.push(event.id);

    const token = await signLocalToken({ userId: organizer.id, email: organizer.email });
    await callOwn(token, "PUT", { headline: "1回目" });
    await callOwn(token, "PUT", { headline: "2回目" });

    const rows = await prisma.organizerProfile.findMany({ where: { userId: organizer.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0].headline).toBe("2回目");
  });

  it("選んだテーマが保存され、公開 API に返る", async () => {
    const organizer = await createUser("テーマを選ぶ主催者");
    userIds.push(organizer.id);
    const event = await seedEvent({ userId: organizer.id, role: "OWNER" });
    eventIds.push(event.id);
    const token = await signLocalToken({ userId: organizer.id, email: organizer.email });

    const saved = await callOwn(token, "PUT", { isPublished: true, themeId: "neon" });
    expect(saved.status).toBe(200);
    expect(saved.body.profile.themeId).toBe("neon");

    const { body } = await callPublic(organizer.id);
    expect(body.profile.themeId).toBe("neon");
  });

  it("テーマを外すと標準（null）に戻る", async () => {
    const organizer = await createUser("テーマを外す主催者");
    userIds.push(organizer.id);
    const event = await seedEvent({ userId: organizer.id, role: "OWNER" });
    eventIds.push(event.id);
    const token = await signLocalToken({ userId: organizer.id, email: organizer.email });

    await callOwn(token, "PUT", { isPublished: true, themeId: "parchment" });
    const cleared = await callOwn(token, "PUT", { isPublished: true, themeId: null });

    expect(cleared.body.profile.themeId).toBeNull();
    const row = await prisma.organizerProfile.findUnique({ where: { userId: organizer.id } });
    expect(row?.themeId).toBeNull();
  });

  it("知らないテーマは 400 で弾く", async () => {
    const organizer = await createUser("知らないテーマを送る主催者");
    userIds.push(organizer.id);
    const event = await seedEvent({ userId: organizer.id, role: "OWNER" });
    eventIds.push(event.id);
    const token = await signLocalToken({ userId: organizer.id, email: organizer.email });

    const { status, body } = await callOwn(token, "PUT", { themeId: "midnight" });

    expect(status).toBe(400);
    expect(body.detail).toContain("テーマ");
  });

  it("非公開に戻すと、テーマも公開 API に出さない", async () => {
    const organizer = await createUser("テーマを隠す主催者");
    userIds.push(organizer.id);
    const event = await seedEvent({ userId: organizer.id, role: "OWNER" });
    eventIds.push(event.id);
    const token = await signLocalToken({ userId: organizer.id, email: organizer.email });

    await callOwn(token, "PUT", { isPublished: true, themeId: "neo-brutalism" });
    await callOwn(token, "PUT", { isPublished: false, themeId: "neo-brutalism" });

    const { body } = await callPublic(organizer.id);

    expect(body.profile.isPublished).toBe(false);
    expect(body.profile.themeId).toBeNull();
  });

  it("催しが0件の会員のページは 404 にする", async () => {
    const organizer = await createUser("催しの無い会員");
    userIds.push(organizer.id);

    const { status } = await callPublic(organizer.id);

    expect(status).toBe(404);
  });

  it("退会した主催者のページは 404 にする", async () => {
    const organizer = await createUser("退会する主催者");
    userIds.push(organizer.id);
    const event = await seedEvent({ userId: organizer.id, role: "OWNER" });
    eventIds.push(event.id);
    await prisma.user.update({ where: { id: organizer.id }, data: { deletedAt: new Date() } });

    const { status } = await callPublic(organizer.id);

    expect(status).toBe(404);
  });

  it("形が UUID でない URL は 404 にする", async () => {
    const { status } = await callPublic("not-a-uuid");

    expect(status).toBe(404);
  });

  it("未ログインでは編集できない", async () => {
    const { status } = await callOwn(null);

    expect(status).toBe(401);
  });

  it("催しを持たない会員は編集できない", async () => {
    const member = await createUser("催しの無い会員");
    userIds.push(member.id);
    const token = await signLocalToken({ userId: member.id, email: member.email });

    const { status, body } = await callOwn(token);

    expect(status).toBe(403);
    expect(body.error).toBe("NOT_ORGANIZER");
  });

  it("http の URL は 400 で弾く", async () => {
    const organizer = await createUser("URLを間違える主催者");
    userIds.push(organizer.id);
    const event = await seedEvent({ userId: organizer.id, role: "OWNER" });
    eventIds.push(event.id);
    const token = await signLocalToken({ userId: organizer.id, email: organizer.email });

    const { status, body } = await callOwn(token, "PUT", { websiteUrl: "http://example.com" });

    expect(status).toBe(400);
    expect(body.detail).toContain("https://");
  });

  it("実績は開催済みの催しだけを数え、オフなら出さない", async () => {
    const organizer = await createUser("実績を出す主催者");
    userIds.push(organizer.id);
    const held = await seedEvent({ userId: organizer.id, role: "OWNER" });
    const future = await seedEvent({ userId: organizer.id, role: "OWNER" });
    eventIds.push(held.id, future.id);
    await addSchedule(held.id, "2025-05-10");
    await addSchedule(future.id, "2027-05-10");
    const token = await signLocalToken({ userId: organizer.id, email: organizer.email });

    await callOwn(token, "PUT", { isPublished: true, showStats: true });
    const shown = await callPublic(organizer.id);
    expect(shown.body.profile.stats).toEqual({ eventCount: 1, sinceYear: 2025 });

    await callOwn(token, "PUT", { isPublished: true, showStats: false });
    const hidden = await callPublic(organizer.id);
    expect(hidden.body.profile.stats).toBeNull();
  });

  it("編集画面の応答に、自分の下書きと実績が入る", async () => {
    const organizer = await createUser("下書きを読む主催者");
    userIds.push(organizer.id);
    const event = await seedEvent({ userId: organizer.id, role: "OWNER" });
    eventIds.push(event.id);
    await addSchedule(event.id, "2025-04-01");
    const token = await signLocalToken({ userId: organizer.id, email: organizer.email });

    const { status, body } = await callOwn(token);

    expect(status).toBe(200);
    expect(body.name).toBe("下書きを読む主催者");
    expect(body.homePath).toBe(`/organizers/${organizer.id}`);
    expect(body.profile).toMatchObject({ isPublished: false, tags: [], xUrl: "" });
    expect(body.stats).toEqual({ eventCount: 1, sinceYear: 2025 });
  });
});
