import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { SignJWT } from "jose";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { copyFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * モック（style-guide/mock-*.html）と同じ密度で画面を見るためのデータを作る。
 *
 *   npm run db:seed:ui
 *
 * 何度実行してもデモ用の 3 アカウントと、その催しだけを作り直す。
 * 他の会員・催しには触らない。撮影用の識別子は storage/ui-demo.json に書き出す。
 *
 * 画面を見るためのデータなので、業務上の意味（按分・領収書・利用枠）は
 * 実装が読む列にだけ入れ、計算結果を直接持たせない。
 */

const ORGANIZER = {
  email: "ui.organizer@example.com",
  // 漏えい済みパスワードの照合に当たらない値にする。
  password: "UiDemo-Organizer-2026!",
  name: "佐藤 みのり",
  phone: "+8190000000101",
};

const PARTICIPANT = {
  email: "ui.participant@example.com",
  password: "UiDemo-Participant-2026!",
  name: "山田 花子",
  phone: "+8190000000102",
};

const CO_HOST = {
  email: "ui.cohost@example.com",
  password: "UiDemo-Cohost-2026!",
  name: "高橋 直樹",
  phone: "+8190000000103",
};

/**
 * メールアドレス変更の確認画面だけに使う会員。
 * 確定するとセッションが総入れ替えになるので、他の画面の Cookie とは分ける。
 */
const VERIFY_USER = {
  email: "ui.verify@example.com",
  confirmedEmail: "ui.verify.confirmed@example.com",
  // 幅ごとに別の確認リンクを使う。1 回の撮影で 2 枚撮るため、
  // 同じトークンだと 2 枚目が「使用済み」になる。
  confirmedEmailWide: "ui.verify.confirmed2@example.com",
  password: "UiDemo-Verify-2026!",
  name: "確認 用",
  phone: "+8190000000104",
};

const INVITE_CODE = "ui-demo-cohost-invite-code";
const EMAIL_VERIFY_TOKEN = "ui-demo-email-verify-token";
const EMAIL_CHANGE_TOKENS = {
  "390": "ui-demo-email-change-token-390",
  "1280": "ui-demo-email-change-token-1280",
};

const TOKYO_OFFSET_MS = 9 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** 日本時間の今日を `YYYY-MM-DD` で返す。 */
function todayInTokyo() {
  return new Date(Date.now() + TOKYO_OFFSET_MS).toISOString().slice(0, 10);
}

function addDays(date, days) {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

function toDate(date) {
  return new Date(`${date}T00:00:00.000Z`);
}

/** 日本時間の `YYYY-MM-DD HH:mm` を UTC の Date にする。 */
function tokyoDateTime(date, time) {
  return new Date(`${date}T${time}:00.000+09:00`);
}

function composeEventTime(startTime, endTime) {
  if (!startTime || !endTime) return "";
  if (endTime < startTime) return `${startTime}〜翌${endTime}`;
  return `${startTime}〜${endTime}`;
}

function schedule(eventDate, startTime, endTime, sortOrder) {
  return {
    eventDate: toDate(eventDate),
    eventTime: composeEventTime(startTime, endTime),
    startTime,
    endTime,
    sortOrder,
  };
}

function tokenHash() {
  return createHash("sha256").update(randomBytes(24)).digest("hex");
}

function sha256(input) {
  return createHash("sha256").update(input).digest("hex");
}

const prisma = new PrismaClient();

const ROOT = process.cwd();
const STORAGE = path.join(ROOT, "storage");
const FLYER_DIR = path.join(STORAGE, "flyers");
const OUT_FILE = path.join(STORAGE, "ui-demo.json");
const SAMPLE_FLYER = path.join(ROOT, "public", "samples", "flyer-autumn.jpg");

/** パスワードと確認済みメール・電話を持つ会員を用意する。 */
async function upsertUser(account) {
  const passwordHash = await bcrypt.hash(account.password, 12);
  const now = new Date();

  // 前回の実行でメールだけが変わった会員が残っていることがある。
  // 電話番号は一意なので、同じ電話番号の行を先に正規のメールへ戻してから upsert する。
  const stray = await prisma.user.findFirst({
    where: { phoneE164: account.phone, email: { not: account.email } },
    select: { id: true },
  });
  if (stray) {
    const taken = await prisma.user.findUnique({
      where: { email: account.email },
      select: { id: true },
    });
    await prisma.user.update({
      where: { id: stray.id },
      // 正規のメールが既にあるなら、残っている行は撮影に使わない。電話番号だけ外す。
      data: taken ? { phoneE164: null, phoneVerifiedAt: null } : { email: account.email },
    });
  }

  const user = await prisma.user.upsert({
    where: { email: account.email },
    create: {
      email: account.email,
      name: account.name,
      passwordHash,
      emailVerifiedAt: now,
      phoneE164: account.phone,
      phoneVerifiedAt: now,
      quota: { create: {} },
    },
    update: {
      name: account.name,
      passwordHash,
      emailVerifiedAt: now,
      phoneE164: account.phone,
      phoneVerifiedAt: now,
      deletedAt: null,
    },
  });
  return user;
}

/**
 * 確認画面用の会員。前回の実行でメールが確定していることがあるので、
 * 2 つのアドレスのどちらでも見つけて元に戻す。
 */
async function upsertVerifyUser() {
  const existing = await prisma.user.findFirst({
    where: {
      email: { in: [VERIFY_USER.email, VERIFY_USER.confirmedEmail, VERIFY_USER.confirmedEmailWide] },
    },
    select: { id: true },
  });
  if (!existing) return upsertUser(VERIFY_USER);
  const passwordHash = await bcrypt.hash(VERIFY_USER.password, 12);
  const now = new Date();
  return prisma.user.update({
    where: { id: existing.id },
    data: {
      email: VERIFY_USER.email,
      name: VERIFY_USER.name,
      passwordHash,
      emailVerifiedAt: now,
      phoneE164: VERIFY_USER.phone,
      phoneVerifiedAt: now,
      deletedAt: null,
    },
  });
}

/**
 * 撮影スクリプトがブラウザへ入れる Cookie 用の JWT。
 * ログインの第二段階（SMS）を挟まずに、同じ会員として画面を開くためだけに使う。
 */
async function issueSessionToken(user) {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < 32) {
    return null;
  }
  const session = await prisma.authSession.create({
    data: { userId: user.id, expiresAt: new Date(Date.now() + 7 * DAY_MS) },
  });
  const token = await new SignJWT({ userId: user.id, email: user.email })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(user.id)
    .setJti(session.id)
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(new TextEncoder().encode(secret));
  return token;
}

/** サンプルのチラシ画像を storage に置き、配信用の行を作る。 */
async function createFlyer(userId, title) {
  const id = randomUUID();
  await mkdir(FLYER_DIR, { recursive: true });
  await copyFile(SAMPLE_FLYER, path.join(FLYER_DIR, `${id}.jpg`));
  return prisma.flyerAsset.create({
    data: {
      id,
      userId,
      imageUrl: `/api/v1/flyer-assets/${id}/image`,
      aspectRatio: "9:16",
      title,
    },
  });
}

try {
  const [organizer, participant, coHost, verifyUser] = await Promise.all([
    upsertUser(ORGANIZER),
    upsertUser(PARTICIPANT),
    upsertUser(CO_HOST),
    upsertVerifyUser(),
  ]);

  await prisma.userUsageQuota.upsert({
    where: { userId: organizer.id },
    create: { userId: organizer.id, freeEventCount: 1 },
    update: {
      freeEventCount: 1,
      paidCredits: 0,
      subscriptionStatus: "NONE",
      currentPeriodEnd: null,
      stripeCustomerId: null,
      stripeSubscriptionId: null,
    },
  });
  for (const user of [participant, coHost, verifyUser]) {
    await prisma.userUsageQuota.upsert({
      where: { userId: user.id },
      create: { userId: user.id },
      update: {},
    });
  }

  // 公開プロフィール。タグは 3 つまで。リンクは 4 種を埋める。
  await prisma.organizerProfile.upsert({
    where: { userId: organizer.id },
    create: {
      userId: organizer.id,
      isPublished: true,
      headline: "月に一度、川辺でごはんを炊く人",
      bio: "2019 年から、川辺で芋煮会と焚き火会を開いています。\n子ども連れでも来られる、ゆるい集まりです。",
      area: "東京都 世田谷区",
      tags: ["FOOD", "LOCAL", "MUSIC"],
      xUrl: "https://x.com/example_minori",
      instagramUrl: "https://www.instagram.com/example_minori",
      websiteUrl: "https://example.com/minori",
      lineUrl: "https://lin.ee/example",
      showStats: true,
    },
    update: {
      isPublished: true,
      headline: "月に一度、川辺でごはんを炊く人",
      bio: "2019 年から、川辺で芋煮会と焚き火会を開いています。\n子ども連れでも来られる、ゆるい集まりです。",
      area: "東京都 世田谷区",
      tags: ["FOOD", "LOCAL", "MUSIC"],
      xUrl: "https://x.com/example_minori",
      instagramUrl: "https://www.instagram.com/example_minori",
      websiteUrl: "https://example.com/minori",
      lineUrl: "https://lin.ee/example",
      showStats: true,
    },
  });
  await prisma.organizerProfile.upsert({
    where: { userId: coHost.id },
    create: { userId: coHost.id, isPublished: false },
    update: {},
  });

  // 前回のデモ催しを消す（出欠・領収書・招待はカスケードで消える）。
  const removed = await prisma.event.deleteMany({
    where: { organizers: { some: { userId: { in: [organizer.id, coHost.id] } } } },
  });

  const today = todayInTokyo();
  // 来月の 8 日。月末に実行しても過去日にならないよう、月をまたいで計算する。
  const [todayYear, todayMonth] = today.split("-").map(Number);
  const nextMonth = `${todayMonth === 12 ? todayYear + 1 : todayYear}-${String(
    todayMonth === 12 ? 1 : todayMonth + 1,
  ).padStart(2, "0")}-08`;

  const flyerMain = await createFlyer(organizer.id, "秋の芋煮会");
  const flyerDraft = await createFlyer(organizer.id, "下書きの披露宴");

  /**
   * 催しを 1 件作り、日程・費用プラン・幹事・出欠をまとめて入れる。
   * 出欠の金額は「確定時点のスナップショット」なので、プランから写す。
   */
  async function createEvent(input) {
    const event = await prisma.event.create({
      data: {
        title: input.title,
        sortDate: toDate(input.sortDate),
        location: input.location,
        venueName: input.venueName ?? null,
        rainPolicy: input.rainPolicy ?? "RAIN_OR_SHINE",
        capacity: input.capacity ?? null,
        status: input.status,
        visibility: "UNLISTED",
        rsvpDeadline: input.rsvpDeadline ?? null,
        flyerAssetId: input.flyerAssetId ?? null,
        quotaChargedAt: input.status === "DRAFT" ? null : new Date(),
        organizers: {
          create: [
            { userId: organizer.id, role: "OWNER" },
            ...(input.withCoHost ? [{ userId: coHost.id, role: "CO_HOST" }] : []),
          ],
        },
        schedules: { create: input.schedules },
        pricePlans: { create: input.plans.map((plan, index) => ({ ...plan, sortOrder: index })) },
      },
      include: {
        schedules: { orderBy: { sortOrder: "asc" } },
        pricePlans: { orderBy: { sortOrder: "asc" } },
      },
    });

    const created = [];
    for (const [index, row] of (input.participants ?? []).entries()) {
      const plan = row.planIndex === undefined ? null : event.pricePlans[row.planIndex];
      const chosenSchedule =
        row.scheduleIndex === undefined ? null : event.schedules[row.scheduleIndex];
      const isParticipantUser = row.asParticipantUser === true;
      const record = await prisma.participant.create({
        data: {
          eventId: event.id,
          userId: isParticipantUser ? participant.id : null,
          rsvpTokenHash: tokenHash(),
          name: row.name,
          gender: row.gender ?? null,
          status: row.status,
          comment: row.comment ?? null,
          scheduleId: chosenSchedule?.id ?? null,
          pricePlanId: plan?.id ?? null,
          priceAmount: plan ? plan.amount : null,
          pricePlanName: plan ? plan.name : null,
          priceAudience: plan ? plan.audience : null,
          waitlistedAt:
            row.status === "WAITLISTED" ? new Date(Date.now() - (index + 1) * 3600 * 1000) : null,
          createdAt: new Date(Date.now() - (10 - index) * 3600 * 1000),
        },
      });
      if (row.receipt) {
        await prisma.receipt.create({
          data: {
            participantId: record.id,
            eventId: event.id,
            addressee: row.name,
            amount: row.receipt.amount,
            description: row.receipt.description,
            issuerName: row.receipt.issuerName ?? organizer.name,
            issuedAt: new Date(Date.now() - 3 * DAY_MS),
          },
        });
      }
      created.push(record);
    }

    return { event, participants: created };
  }

  const main = await createEvent({
    title: "秋の芋煮会",
    sortDate: nextMonth,
    location: "河川敷公園 第2広場（東京都世田谷区）",
    venueName: "河川敷公園 第2広場",
    capacity: 40,
    status: "PUBLISHED",
    flyerAssetId: flyerMain.id,
    withCoHost: true,
    rsvpDeadline: tokyoDateTime(addDays(today, 3), "23:59"),
    schedules: [schedule(nextMonth, "11:00", "15:00", 0)],
    plans: [
      { name: "大人", audience: "ANY", amount: 1500, note: "1ドリンク付" },
      { name: "学生", audience: "ANY", amount: 1000, note: null },
      { name: "子ども", audience: "ANY", amount: 0, note: "小学生まで" },
    ],
    participants: [
      {
        name: PARTICIPANT.name,
        asParticipantUser: true,
        gender: "FEMALE",
        status: "ATTENDING",
        planIndex: 0,
        scheduleIndex: 0,
        comment: "子ども用に椅子を1脚お願いします",
        receipt: { amount: 1500, description: "秋の芋煮会 参加費" },
      },
      { name: "鈴木 大輔", gender: "MALE", status: "ATTENDING", planIndex: 0, scheduleIndex: 0 },
      { name: "伊藤 さくら", gender: "FEMALE", status: "ATTENDING", planIndex: 1, scheduleIndex: 0 },
      { name: "渡辺 健", gender: "MALE", status: "ATTENDING", planIndex: 0, scheduleIndex: 0, comment: "遅れて 12時ごろ行きます" },
      { name: "中村 あゆみ", gender: "FEMALE", status: "ATTENDING", planIndex: 2, scheduleIndex: 0 },
      { name: "小林 亮", gender: "MALE", status: "ATTENDING", planIndex: 1, scheduleIndex: 0 },
      { name: "加藤 みなみ", gender: "FEMALE", status: "ATTENDING", planIndex: 0, scheduleIndex: 0 },
      { name: "吉田 翔", gender: "MALE", status: "ATTENDING", planIndex: 2, scheduleIndex: 0 },
      { name: "山本 かおり", gender: "FEMALE", status: "ATTENDING", planIndex: 0, scheduleIndex: 0 },
      { name: "松本 拓也", gender: "MALE", status: "WAITLISTED", planIndex: 0, scheduleIndex: 0 },
      { name: "井上 由紀", gender: "FEMALE", status: "WAITLISTED", planIndex: 1, scheduleIndex: 0 },
      { name: "木村 修", gender: "MALE", status: "DECLINED", scheduleIndex: 0 },
    ],
  });

  const full = await createEvent({
    title: "冬の焚き火会",
    sortDate: addDays(today, 20),
    location: "河川敷公園 焚き火広場",
    capacity: 3,
    status: "PUBLISHED",
    rsvpDeadline: tokyoDateTime(addDays(today, 12), "23:59"),
    schedules: [schedule(addDays(today, 20), "16:00", "19:00", 0)],
    plans: [{ name: "一般", audience: "ANY", amount: 1200, note: null }],
    participants: [
      { name: "鈴木 大輔", gender: "MALE", status: "ATTENDING", planIndex: 0, scheduleIndex: 0 },
      { name: "伊藤 さくら", gender: "FEMALE", status: "ATTENDING", planIndex: 0, scheduleIndex: 0 },
      { name: "渡辺 健", gender: "MALE", status: "ATTENDING", planIndex: 0, scheduleIndex: 0 },
      {
        name: PARTICIPANT.name,
        asParticipantUser: true,
        gender: "FEMALE",
        status: "WAITLISTED",
        planIndex: 0,
        scheduleIndex: 0,
        comment: "空きが出たら教えてください",
      },
    ],
  });

  const closed = await createEvent({
    title: "写真展「夜の港」",
    sortDate: addDays(today, -12),
    location: "港の倉庫街 ギャラリーB",
    capacity: 30,
    status: "CLOSED",
    schedules: [schedule(addDays(today, -12), "18:00", "21:00", 0)],
    plans: [
      { name: "一般", audience: "ANY", amount: 800, note: null },
      { name: "学生", audience: "ANY", amount: 500, note: null },
    ],
    participants: [
      {
        name: PARTICIPANT.name,
        asParticipantUser: true,
        gender: "FEMALE",
        status: "DECLINED",
        scheduleIndex: 0,
      },
      { name: "中村 あゆみ", gender: "FEMALE", status: "ATTENDING", planIndex: 0, scheduleIndex: 0 },
      { name: "小林 亮", gender: "MALE", status: "ATTENDING", planIndex: 1, scheduleIndex: 0 },
    ],
  });

  const takoyaki = await createEvent({
    title: "第3回 たこ焼きパーティー",
    sortDate: addDays(today, 29),
    location: "集会所 2F（東京都杉並区）",
    venueName: "集会所 2F",
    capacity: 20,
    status: "PUBLISHED",
    schedules: [schedule(addDays(today, 29), "18:00", "21:00", 0)],
    plans: [{ name: "一般", audience: "ANY", amount: 1200, note: "材料費込み" }],
    participants: [
      {
        name: PARTICIPANT.name,
        asParticipantUser: true,
        gender: "FEMALE",
        status: "ATTENDING",
        planIndex: 0,
        scheduleIndex: 0,
      },
      { name: "鈴木 大輔", gender: "MALE", status: "ATTENDING", planIndex: 0, scheduleIndex: 0 },
      { name: "加藤 みなみ", gender: "FEMALE", status: "ATTENDING", planIndex: 0, scheduleIndex: 0 },
      { name: "山本 かおり", gender: "FEMALE", status: "WAITLISTED", planIndex: 0, scheduleIndex: 0 },
      { name: "吉田 翔", gender: "MALE", status: "DECLINED", scheduleIndex: 0 },
    ],
  });

  const lastMonth = await createEvent({
    title: "先月の芋煮会",
    sortDate: addDays(today, -35),
    location: "河川敷公園 第2広場",
    capacity: 30,
    status: "PUBLISHED",
    schedules: [schedule(addDays(today, -35), "11:00", "15:00", 0)],
    plans: [{ name: "大人", audience: "ANY", amount: 1500, note: null }],
    participants: [
      {
        name: PARTICIPANT.name,
        asParticipantUser: true,
        gender: "FEMALE",
        status: "ATTENDING",
        planIndex: 0,
        scheduleIndex: 0,
        receipt: { amount: 3000, description: "先月の芋煮会 参加費" },
      },
      { name: "伊藤 さくら", gender: "FEMALE", status: "ATTENDING", planIndex: 0, scheduleIndex: 0 },
      { name: "渡辺 健", gender: "MALE", status: "ATTENDING", planIndex: 0, scheduleIndex: 0 },
      { name: "中村 あゆみ", gender: "FEMALE", status: "DECLINED", scheduleIndex: 0 },
    ],
  });

  const draft = await createEvent({
    title: "下書きの披露宴",
    sortDate: addDays(today, 45),
    location: "代官山のレストラン",
    capacity: null,
    status: "DRAFT",
    flyerAssetId: flyerDraft.id,
    schedules: [schedule(addDays(today, 45), "17:00", "20:00", 0)],
    plans: [{ name: "一般", audience: "ANY", amount: 6000, note: null }],
  });

  // 共同幹事の招待（1 件だけ有効なコードを持つ）。前回の行は消してから作り直す。
  await prisma.eventInvitation.deleteMany({
    where: { inviteCodeHash: sha256(INVITE_CODE) },
  });
  await prisma.eventInvitation.create({
    data: {
      eventId: main.event.id,
      inviteCodeHash: sha256(INVITE_CODE),
      expiresAt: new Date(Date.now() + 5 * DAY_MS),
    },
  });

  // 確認メールのリンク（/auth/verify）。確認済みの会員なので着地はログイン。
  await prisma.emailVerificationToken.deleteMany({
    where: { tokenHash: { in: [sha256(EMAIL_VERIFY_TOKEN)] } },
  });
  await prisma.emailVerificationToken.create({
    data: {
      userId: organizer.id,
      tokenHash: sha256(EMAIL_VERIFY_TOKEN),
      expiresAt: new Date(Date.now() + DAY_MS),
    },
  });

  // メールアドレス変更の確認（/account/email/verify）。
  // 確定するとその会員のセッションは作り直される。他の画面の Cookie を巻き込まないよう、
  // 確認専用の会員に対してだけ発行する。幅ごとに 1 本ずつ用意する。
  await prisma.emailChangeRequest.deleteMany({
    where: { tokenHash: { in: Object.values(EMAIL_CHANGE_TOKENS).map(sha256) } },
  });
  await prisma.emailChangeRequest.createMany({
    data: [
      {
        userId: verifyUser.id,
        newEmail: VERIFY_USER.confirmedEmail,
        tokenHash: sha256(EMAIL_CHANGE_TOKENS["390"]),
        expiresAt: new Date(Date.now() + DAY_MS),
      },
      {
        userId: verifyUser.id,
        newEmail: VERIFY_USER.confirmedEmailWide,
        tokenHash: sha256(EMAIL_CHANGE_TOKENS["1280"]),
        expiresAt: new Date(Date.now() + DAY_MS),
      },
    ],
  });

  // 編集の排他ロック（共同幹事が編集中の状態）。編集画面を撮る催しには置かない。
  await prisma.eventLock.create({
    data: {
      eventId: takoyaki.event.id,
      lockedByUserId: coHost.id,
      lockHolderName: coHost.name,
      lockTokenHash: tokenHash(),
    },
  });

  const tokens = {
    organizer: await issueSessionToken(organizer),
    participant: await issueSessionToken(participant),
    // 参加履歴が空の状態を見るため、出欠を持たない会員も 1 人用意する。
    coHost: await issueSessionToken(coHost),
    // メールアドレス変更の確認画面だけに使う。
    verifyUser: await issueSessionToken(verifyUser),
  };

  const base = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3012";
  const result = {
    baseUrl: base,
    generatedAt: new Date().toISOString(),
    accounts: {
      organizer: { email: ORGANIZER.email, password: ORGANIZER.password },
      participant: { email: PARTICIPANT.email, password: PARTICIPANT.password },
      coHost: { email: CO_HOST.email, password: CO_HOST.password },
      verifyUser: { email: VERIFY_USER.email, password: VERIFY_USER.password },
    },
    tokens,
    events: {
      main: main.event.id,
      full: full.event.id,
      closed: closed.event.id,
      takoyaki: takoyaki.event.id,
      lastMonth: lastMonth.event.id,
      draft: draft.event.id,
    },
    participantId: participant.id,
    organizerId: organizer.id,
    coHostId: coHost.id,
    receiptParticipant: main.participants[0].id,
    inviteCode: INVITE_CODE,
    emailVerifyToken: EMAIL_VERIFY_TOKEN,
    emailChangeTokens: EMAIL_CHANGE_TOKENS,
  };

  await mkdir(STORAGE, { recursive: true });
  await writeFile(OUT_FILE, `${JSON.stringify(result, null, 2)}\n`, "utf8");

  console.log("UI 確認用のデータを用意しました。");
  console.log(`  主催者: ${ORGANIZER.email} / ${ORGANIZER.password}`);
  console.log(`  参加者: ${PARTICIPANT.email} / ${PARTICIPANT.password}`);
  console.log(`  共同幹事: ${CO_HOST.email} / ${CO_HOST.password}`);
  console.log(`  確認用: ${VERIFY_USER.email} / ${VERIFY_USER.password}`);
  console.log(`  前回のデモ催し削除: ${removed.count} 件`);
  console.log("  催し:");
  console.log(`    秋の芋煮会（公開中・チラシ・定員40）: ${main.event.id}`);
  console.log(`    冬の焚き火会（満員・定員3）: ${full.event.id}`);
  console.log(`    写真展「夜の港」（受付停止）: ${closed.event.id}`);
  console.log(`    第3回 たこ焼きパーティー（チラシなし）: ${takoyaki.event.id}`);
  console.log(`    先月の芋煮会（過去日・領収書）: ${lastMonth.event.id}`);
  console.log(`    下書きの披露宴（下書き）: ${draft.event.id}`);
  console.log(`  招待コード: ${INVITE_CODE}`);
  console.log(`  書き出し: storage/ui-demo.json`);
  if (!tokens.organizer) {
    console.log("  JWT_SECRET が無いため、撮影用の Cookie は作りませんでした（--env-file=.env で実行してください）。");
  }
} finally {
  await prisma.$disconnect();
}
