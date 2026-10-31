import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { SignJWT } from "jose";
import sharp from "sharp";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { copyFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * モック（style-guide/mock-*.html）と同じ密度で画面を見るためのデータを作る。
 *
 *   npm run db:seed:ui
 *
 * 何度実行してもデモ用のアカウントと、その催しだけを作り直す。
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
 * 帯（`QuotaStatusBanner`）の見え方を確かめるための会員。
 * 催しの持ち主を分けて、月額で8件まで公開・公開し放題・未加入の 3 通りを並べる。
 */
const ORGANIZER_UNLIMITED = {
  email: "ui.organizer-unlimited@example.com",
  password: "UiDemo-Unlimited-2026!",
  name: "森 あかり",
  phone: "+8190000000105",
};

const ORGANIZER_FREE = {
  email: "ui.organizer-free@example.com",
  password: "UiDemo-Free-2026!",
  name: "青木 拓海",
  phone: "+8190000000106",
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

/**
 * 直近のクリスマス（12 月 20 日）。
 * 12 月 21 日以降に実行したときは翌年へ送り、開催日が過去にならないようにする。
 */
function upcomingChristmas(today) {
  const [year, month, day] = today.split("-").map(Number);
  const passed = month === 12 && day > 20;
  return `${passed ? year + 1 : year}-12-20`;
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
const IMAGE_DIR = path.join(STORAGE, "images");
const OUT_FILE = path.join(STORAGE, "ui-demo.json");
/** チラシの見本。催しごとに 1 枚を写して、撮り直しても見た目が変わらないようにする。 */
const SAMPLE_DIR = path.join(ROOT, "public", "samples");

/** デモ主催者のアイコン。内容も ID も固定にして、撮り直しても画像名が変わらないようにする。 */
const DEMO_AVATAR_ID = "8f3c1d2e-5a4b-4c6d-9e70-2b1a4c8d6f31";

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
async function createFlyer(userId, title, sample = "flyer-autumn.jpg") {
  const id = randomUUID();
  await mkdir(FLYER_DIR, { recursive: true });
  await copyFile(path.join(SAMPLE_DIR, sample), path.join(FLYER_DIR, `${id}.jpg`));
  return prisma.flyerAsset.create({
    data: {
      id,
      userId,
      imageUrl: `/api/v1/flyer-assets/${id}/image`,
      aspectRatio: "A4",
      title,
    },
  });
}

/**
 * デモ主催者のアイコンを置く。
 *
 * アップロード API は通さず、同じ形（256px 角の WebP）を SVG から作って
 * `storage/images` と `image_assets` に直接入れる。固定の ID なので、
 * 何度実行してもモックの画像ファイル名は変わらない。
 */
async function ensureDemoAvatar(userId) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256">
    <defs>
      <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#8b2635"/>
        <stop offset="1" stop-color="#d9a05b"/>
      </linearGradient>
    </defs>
    <rect width="256" height="256" fill="url(#g)"/>
    <circle cx="128" cy="100" r="42" fill="#fbf6e9" opacity="0.92"/>
    <path d="M38 256c0-52 40-86 90-86s90 34 90 86z" fill="#fbf6e9" opacity="0.92"/>
  </svg>`;
  const data = await sharp(Buffer.from(svg)).webp({ quality: 82 }).toBuffer();
  await mkdir(IMAGE_DIR, { recursive: true });
  await writeFile(path.join(IMAGE_DIR, `${DEMO_AVATAR_ID}.webp`), data);
  await prisma.imageAsset.upsert({
    where: { id: DEMO_AVATAR_ID },
    create: {
      id: DEMO_AVATAR_ID,
      userId,
      kind: "AVATAR",
      contentType: "image/webp",
      width: 256,
      height: 256,
      byteSize: data.byteLength,
    },
    update: { userId, isDeleted: false, byteSize: data.byteLength },
  });
  return DEMO_AVATAR_ID;
}

try {
  const [organizer, participant, coHost, verifyUser, organizerUnlimited, organizerFree] =
    await Promise.all([
      upsertUser(ORGANIZER),
      upsertUser(PARTICIPANT),
      upsertUser(CO_HOST),
      upsertVerifyUser(),
      upsertUser(ORGANIZER_UNLIMITED),
      upsertUser(ORGANIZER_FREE),
    ]);

  // スクリーンショット用の加入状態。月額で8件まで公開プランの途中にして、
  // 「月額プランで公開中のイベント N / 8 件」のバナーを撮る。
  // 数えるのは開催日が今日以降で、定額プランから公開したものだけ。
  await prisma.userUsageQuota.upsert({
    where: { userId: organizer.id },
    create: {
      userId: organizer.id,
      freeEventCount: 1,
      subscriptionStatus: "ACTIVE",
      subscriptionPlan: "MONTHLY_8",
      currentPeriodEnd: new Date(Date.now() + 20 * 24 * 60 * 60 * 1000),
    },
    update: {
      freeEventCount: 1,
      paidCredits: 0,
      subscriptionStatus: "ACTIVE",
      subscriptionPlan: "MONTHLY_8",
      currentPeriodEnd: new Date(Date.now() + 20 * 24 * 60 * 60 * 1000),
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

  // 公開し放題の帯は「公開中のイベント N 件（上限はありません）」を出す。件数のために催しを 3 件持たせる。
  await prisma.userUsageQuota.upsert({
    where: { userId: organizerUnlimited.id },
    create: {
      userId: organizerUnlimited.id,
      freeEventCount: 0,
      subscriptionStatus: "ACTIVE",
      subscriptionPlan: "UNLIMITED",
      currentPeriodEnd: new Date(Date.now() + 20 * 24 * 60 * 60 * 1000),
    },
    update: {
      freeEventCount: 0,
      paidCredits: 0,
      subscriptionStatus: "ACTIVE",
      subscriptionPlan: "UNLIMITED",
      currentPeriodEnd: new Date(Date.now() + 20 * 24 * 60 * 60 * 1000),
      stripeCustomerId: null,
      stripeSubscriptionId: null,
    },
  });

  // 未加入の帯は「公開中のイベント 1 件。無料トライアル残り 1回」を出す。
  // 無料枠で 1 件だけ公開した状態にして、残りの数と件数が並ぶ様子を見る。
  await prisma.userUsageQuota.upsert({
    where: { userId: organizerFree.id },
    create: {
      userId: organizerFree.id,
      freeEventCount: 1,
      paidCredits: 0,
      subscriptionStatus: "NONE",
      subscriptionPlan: "NONE",
    },
    update: {
      freeEventCount: 1,
      paidCredits: 0,
      subscriptionStatus: "NONE",
      subscriptionPlan: "NONE",
      currentPeriodEnd: null,
      stripeCustomerId: null,
      stripeSubscriptionId: null,
    },
  });

  // 公開プロフィール。タグは 3 つまで。公開ページに出すのは X と Instagram。
  // テーマは羊皮紙（読み物として見せる）。アイコンと合わせて、モックで適用後の見た目を確認できるようにする。
  const avatarImageId = await ensureDemoAvatar(organizer.id);
  const appearance = {
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
    themeId: "parchment",
    avatarImageId,
  };
  await prisma.organizerProfile.upsert({
    where: { userId: organizer.id },
    create: { userId: organizer.id, ...appearance },
    update: appearance,
  });
  await prisma.organizerProfile.upsert({
    where: { userId: coHost.id },
    create: { userId: coHost.id, isPublished: false },
    update: {},
  });

  // 前回のデモ催しを消す（出欠・領収書・招待はカスケードで消える）。
  const demoUserIds = [
    organizer.id,
    coHost.id,
    organizerUnlimited.id,
    organizerFree.id,
  ];
  const removed = await prisma.event.deleteMany({
    where: { organizers: { some: { userId: { in: demoUserIds } } } },
  });

  const today = todayInTokyo();
  // 来月の 8 日。月末に実行しても過去日にならないよう、月をまたいで計算する。
  const [todayYear, todayMonth] = today.split("-").map(Number);
  const nextMonth = `${todayMonth === 12 ? todayYear + 1 : todayYear}-${String(
    todayMonth === 12 ? 1 : todayMonth + 1,
  ).padStart(2, "0")}-08`;

  const flyerMain = await createFlyer(organizer.id, "秋の芋煮会");
  const flyerDraft = await createFlyer(organizer.id, "下書きの披露宴");
  const flyerGohan = await createFlyer(organizer.id, "秋のゆるごはん会", "flyer-gohan.jpg");
  const flyerCraft = await createFlyer(
    organizer.id,
    "手しごとの市 秋の道具市",
    "flyer-craft-market.jpg",
  );
  const flyerHalloween = await createFlyer(
    organizer.id,
    "ハロウィン おやこマルシェ",
    "flyer-halloween.jpg",
  );
  const flyerBonfire = await createFlyer(organizer.id, "川辺の焚き火ナイト", "flyer-bonfire.jpg");
  const flyerChristmas = await createFlyer(
    organizer.id,
    "クリスマス ダンスパフォーマンス",
    "flyer-christmas.jpg",
  );
  const flyerDj = await createFlyer(organizer.id, "DJナイト Vol.7", "flyer-dj.jpg");

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
        postalCode: input.postalCode ?? null,
        prefecture: input.prefecture ?? null,
        city: input.city ?? null,
        town: input.town ?? null,
        addressLine: input.addressLine ?? null,
        building: input.building ?? null,
        venueName: input.venueName ?? null,
        targetGeneration: input.targetGeneration ?? null,
        themeId: input.themeId ?? null,
        rainPolicy: input.rainPolicy ?? "RAIN_OR_SHINE",
        capacity: input.capacity ?? null,
        status: input.status,
        visibility: "UNLISTED",
        rsvpDeadline: input.rsvpDeadline ?? null,
        flyerAssetId: input.flyerAssetId ?? null,
        quotaChargedAt: input.status === "DRAFT" ? null : new Date(),
        // デモの催しは定額プランから公開した扱いにする。マイページの「プラン公開」と
        // 帯の「N / 8 件」はこの値で数える。未加入の帯を見る会員だけは、無料枠から
        // 公開した扱いにする（FREE_TRIAL。マイページでは「チケット公開」に数える）。
        quotaSource: input.status === "DRAFT" ? null : (input.quotaSource ?? "SUBSCRIPTION"),
        organizers: {
          create: [
            { userId: input.ownerId ?? organizer.id, role: "OWNER" },
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
      // 開催日を過ぎた催しでも不自然にならないよう、申し込んだ日時を開催日から逆算できる。
      // 指定が無いときは「直近 10 時間のあいだに申し込んだ」並びにする。
      const appliedAt =
        row.appliedDaysBefore === undefined
          ? new Date(Date.now() - (10 - index) * 3600 * 1000)
          : (() => {
              const at = new Date(toDate(input.sortDate).getTime() - row.appliedDaysBefore * DAY_MS);
              // 申し込み時刻は昼前後に散らす。日付の境界をまたがない範囲に収める。
              at.setUTCHours(2 + (row.appliedDaysBefore % 9), (row.appliedDaysBefore * 7) % 60, 0, 0);
              return at;
            })();
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
          createdAt: appliedAt,
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

  /**
   * ここから下は、手で作ってあったデモ催しを seed に取り込んだもの。
   *
   * 10 月の 2 件は開催日を過ぎた状態で残し、「過去の催しを除く」の絞り込みと
   * 受付終了の表示を確かめる。申し込み期限は開催日の前日 23:59 に置く。
   * 残る 2 件は公開中で、うち 1 件は参加者ゼロのまま置く。
   */
  const craftDate = addDays(today, -20);
  const halloweenDate = addDays(today, -13);
  const bonfireDate = addDays(today, 1);
  const gohanDate = addDays(today, 15);

  const craftMarket = await createEvent({
    title: "手しごとの市 秋の道具市",
    sortDate: craftDate,
    location: "旧校舎ギャラリー（東京都世田谷区）",
    venueName: "旧校舎ギャラリー",
    rainPolicy: "INDOOR",
    capacity: 60,
    status: "PUBLISHED",
    flyerAssetId: flyerCraft.id,
    targetGeneration: "30代から60代",
    themeId: "washi",
    rsvpDeadline: tokyoDateTime(addDays(craftDate, -1), "23:59"),
    schedules: [schedule(craftDate, "10:00", "16:00", 0)],
    plans: [{ name: "入場", audience: "ANY", amount: 0, note: "どなたでも" }],
    participants: [
      {
        name: "田中 ちひろ",
        gender: "FEMALE",
        status: "ATTENDING",
        planIndex: 0,
        scheduleIndex: 0,
        comment: "木のスプーンを探しに来ます。",
        appliedDaysBefore: 11,
      },
      {
        name: "大野 健",
        gender: "MALE",
        status: "ATTENDING",
        planIndex: 0,
        scheduleIndex: 0,
        comment: "知人の工房が出るので寄ります。",
        appliedDaysBefore: 9,
      },
      {
        name: "森 あやめ",
        gender: "FEMALE",
        status: "ATTENDING",
        planIndex: 0,
        scheduleIndex: 0,
        comment: "午後から伺います。",
        appliedDaysBefore: 6,
      },
      {
        name: "小林 修",
        gender: "MALE",
        status: "DECLINED",
        scheduleIndex: 0,
        comment: "用事が入ってしまいました。次回に。",
        appliedDaysBefore: 4,
      },
    ],
  });

  const halloween = await createEvent({
    title: "ハロウィン おやこマルシェ",
    sortDate: halloweenDate,
    location: "世田谷公園 芝生広場（東京都世田谷区）",
    venueName: "世田谷公園 芝生広場",
    rainPolicy: "CANCEL_ON_RAIN",
    capacity: 40,
    status: "PUBLISHED",
    flyerAssetId: flyerHalloween.id,
    targetGeneration: "未就学児とその家族",
    themeId: "candy",
    rsvpDeadline: tokyoDateTime(addDays(halloweenDate, -1), "23:59"),
    schedules: [schedule(halloweenDate, "11:00", "15:00", 0)],
    plans: [
      { name: "おやつ付き", audience: "ANY", amount: 500, note: "子どもは無料" },
      { name: "子ども", audience: "ANY", amount: 0, note: "未就学児" },
    ],
    participants: [
      {
        name: "佐々木 ゆい",
        gender: "FEMALE",
        status: "ATTENDING",
        planIndex: 0,
        scheduleIndex: 0,
        comment: "子どもと仮装で参加します。",
        appliedDaysBefore: 8,
      },
      {
        name: "佐々木 はると",
        gender: "MALE",
        status: "ATTENDING",
        planIndex: 1,
        scheduleIndex: 0,
        comment: "5 歳です。おやつは家で食べます。",
        appliedDaysBefore: 8,
      },
      {
        name: "中村 みなみ",
        gender: "FEMALE",
        status: "ATTENDING",
        planIndex: 0,
        scheduleIndex: 0,
        comment: "おやつ付きでお願いします。",
        appliedDaysBefore: 5,
      },
    ],
  });

  const bonfire = await createEvent({
    title: "川辺の焚き火ナイト",
    sortDate: bonfireDate,
    location: "河川敷公園 第2広場（東京都世田谷区）",
    venueName: "河川敷公園 第2広場",
    rainPolicy: "POSTPONE_ON_RAIN",
    capacity: 20,
    status: "PUBLISHED",
    flyerAssetId: flyerBonfire.id,
    targetGeneration: "20代から40代",
    themeId: "dusk",
    rsvpDeadline: tokyoDateTime(addDays(bonfireDate, -1), "23:59"),
    schedules: [schedule(bonfireDate, "18:00", "21:00", 0)],
    plans: [{ name: "一般", audience: "ANY", amount: 2500, note: "薪と汁物付" }],
    participants: [
      {
        name: "石井 直人",
        gender: "MALE",
        status: "ATTENDING",
        planIndex: 0,
        scheduleIndex: 0,
        comment: "焚き火、久しぶりです。",
        appliedDaysBefore: 7,
      },
      {
        name: "藤田 さくら",
        gender: "FEMALE",
        status: "ATTENDING",
        planIndex: 0,
        scheduleIndex: 0,
        comment: "汁物は何か持っていきますか？",
        appliedDaysBefore: 3,
      },
      {
        name: "岡本 涼太",
        gender: "MALE",
        status: "DECLINED",
        scheduleIndex: 0,
        comment: "出張で行けなくなりました。",
        appliedDaysBefore: 1,
      },
    ],
  });

  const gohan = await createEvent({
    title: "秋のゆるごはん会",
    sortDate: gohanDate,
    location: "ごはん屋 まめ 東京都世田谷区北沢2-14-3 2F",
    postalCode: "1550031",
    prefecture: "東京都",
    city: "世田谷区",
    town: "北沢",
    addressLine: "2-14-3",
    building: "2F",
    venueName: "ごはん屋 まめ",
    rainPolicy: "INDOOR",
    capacity: 20,
    status: "PUBLISHED",
    flyerAssetId: flyerGohan.id,
    targetGeneration: "20代〜30代",
    themeId: "parchment",
    rsvpDeadline: tokyoDateTime(addDays(gohanDate, -3), "23:59"),
    schedules: [schedule(gohanDate, "18:30", "21:00", 0)],
    plans: [
      { name: "ごはん代", audience: "ANY", amount: 3500, note: "飲み物は別会計（実費）" },
    ],
  });

  /**
   * 0円の単発チケット（無料チケット）で公開した 1 件。
   *
   * 月額プランの 8 件には数えないので、マイページの要約は「プラン公開 7件 /
   * チケット公開 1件」になる。帯の「7 / 8 件」が動かないことも同時に見られる。
   * チケットは公開のときに使い切っているので、`paidCredits` は 0 のままにする。
   */
  const reading = await createEvent({
    quotaSource: "PAID_CREDIT",
    title: "朝の読書会",
    sortDate: addDays(today, 7),
    location: "ブックカフェ 栞（東京都世田谷区北沢）",
    postalCode: "1550031",
    prefecture: "東京都",
    city: "世田谷区",
    town: "北沢",
    addressLine: "1-8-2",
    building: "1F",
    venueName: "ブックカフェ 栞",
    rainPolicy: "INDOOR",
    capacity: 12,
    status: "PUBLISHED",
    targetGeneration: "20代〜40代",
    themeId: "sage",
    rsvpDeadline: tokyoDateTime(addDays(today, 6), "23:59"),
    schedules: [schedule(addDays(today, 7), "09:00", "11:00", 0)],
    plans: [{ name: "参加費", audience: "ANY", amount: 800, note: "飲み物付" }],
    participants: [
      {
        name: "藤田 さくら",
        gender: "FEMALE",
        status: "ATTENDING",
        planIndex: 0,
        scheduleIndex: 0,
        comment: "読みかけの本を持って行きます。",
        appliedDaysBefore: 5,
      },
      {
        name: "岡本 涼太",
        gender: "MALE",
        status: "ATTENDING",
        planIndex: 0,
        scheduleIndex: 0,
        comment: "途中からでも大丈夫ですか？",
        appliedDaysBefore: 2,
      },
      {
        name: "田中 ちひろ",
        gender: "FEMALE",
        status: "DECLINED",
        scheduleIndex: 0,
        comment: "早起きがかなわず。次回こそ。",
        appliedDaysBefore: 1,
      },
    ],
  });

  /**
   * 12 月の 2 件。夜の催しの見本として、屋内・21 時開始・当日精算の形を入れる。
   * クリスマスは 12 月 20 日、DJ はそこから 2 週間ほど前の金曜に置く。
   */
  const christmasDate = upcomingChristmas(today);
  const djDate = addDays(today, 34);

  const christmas = await createEvent({
    title: "クリスマス ダンスパフォーマンス",
    sortDate: christmasDate,
    location: "北沢タウンホール（東京都世田谷区代沢）",
    postalCode: "1550032",
    prefecture: "東京都",
    city: "世田谷区",
    town: "代沢",
    addressLine: "2-3-1",
    venueName: "北沢タウンホール",
    rainPolicy: "INDOOR",
    capacity: 80,
    status: "PUBLISHED",
    flyerAssetId: flyerChristmas.id,
    targetGeneration: "10代後半〜30代",
    themeId: "parchment",
    rsvpDeadline: tokyoDateTime(addDays(christmasDate, -5), "23:59"),
    schedules: [schedule(christmasDate, "18:00", "20:30", 0)],
    plans: [{ name: "前売", audience: "ANY", amount: 3000, note: "当日は3,500円" }],
    participants: [
      {
        name: PARTICIPANT.name,
        asParticipantUser: true,
        gender: "FEMALE",
        status: "ATTENDING",
        planIndex: 0,
        scheduleIndex: 0,
        comment: "友だちと2人で行きます。",
        appliedDaysBefore: 9,
      },
      {
        name: "高木 蓮",
        gender: "MALE",
        status: "ATTENDING",
        planIndex: 0,
        scheduleIndex: 0,
        comment: "前売で1枚お願いします。",
        appliedDaysBefore: 7,
      },
      {
        name: "中村 あゆみ",
        gender: "FEMALE",
        status: "ATTENDING",
        planIndex: 0,
        scheduleIndex: 0,
        comment: "演出の写真を撮らせてください。",
        appliedDaysBefore: 4,
      },
      {
        name: "石井 直人",
        gender: "MALE",
        status: "WAITLISTED",
        planIndex: 0,
        scheduleIndex: 0,
        appliedDaysBefore: 2,
      },
      {
        name: "岡本 涼太",
        gender: "MALE",
        status: "DECLINED",
        scheduleIndex: 0,
        comment: "仕事が入ってしまいました。",
        appliedDaysBefore: 1,
      },
    ],
  });

  const djNight = await createEvent({
    title: "DJナイト Vol.7",
    sortDate: djDate,
    location: "BAR LOOP 下北沢（東京都世田谷区北沢）",
    postalCode: "1550032",
    prefecture: "東京都",
    city: "世田谷区",
    town: "北沢",
    addressLine: "2-10-5",
    building: "B1",
    venueName: "BAR LOOP 下北沢",
    rainPolicy: "INDOOR",
    capacity: 60,
    status: "PUBLISHED",
    flyerAssetId: flyerDj.id,
    targetGeneration: "20代〜30代",
    themeId: "neon",
    rsvpDeadline: tokyoDateTime(addDays(djDate, -1), "23:59"),
    schedules: [schedule(djDate, "21:00", "02:00", 0)],
    plans: [{ name: "一般", audience: "ANY", amount: 2500, note: "1ドリンク付" }],
    participants: [
      {
        name: PARTICIPANT.name,
        asParticipantUser: true,
        gender: "FEMALE",
        status: "ATTENDING",
        planIndex: 0,
        scheduleIndex: 0,
        comment: "22 時ごろに伺います。",
        appliedDaysBefore: 6,
      },
      {
        name: "藤田 さくら",
        gender: "FEMALE",
        status: "ATTENDING",
        planIndex: 0,
        scheduleIndex: 0,
        comment: "1 ドリンクは何がありますか？",
        appliedDaysBefore: 5,
      },
      {
        name: "鈴木 大輔",
        gender: "MALE",
        status: "ATTENDING",
        planIndex: 0,
        scheduleIndex: 0,
        appliedDaysBefore: 3,
      },
      {
        name: "山本 かおり",
        gender: "FEMALE",
        status: "WAITLISTED",
        planIndex: 0,
        scheduleIndex: 0,
        appliedDaysBefore: 2,
      },
    ],
  });

  /**
   * 帯の見え方を撮るための催し。
   *
   * 公開し放題の会員は 3 件、未加入の会員は無料枠から 1 件だけ持たせる。
   * 公開中の件数は「開催日が今日以降」で数えるので、いずれも未来の日付にする。
   */
  const unlimitedEvents = [];
  const unlimitedRows = [
    { title: "森のピクニック", days: 5, place: "砧公園 芝生広場（東京都世田谷区）" },
    { title: "朝のヨガ広場", days: 12, place: "二子玉川 河川敷（東京都世田谷区）" },
    { title: "手づくりパン教室", days: 25, place: "三軒茶屋の公民館 調理室（東京都世田谷区）" },
  ];
  for (const row of unlimitedRows) {
    const date = addDays(today, row.days);
    unlimitedEvents.push(
      await createEvent({
        ownerId: organizerUnlimited.id,
        title: row.title,
        sortDate: date,
        location: row.place,
        capacity: 20,
        status: "PUBLISHED",
        schedules: [schedule(date, "10:00", "12:00", 0)],
        plans: [{ name: "一般", audience: "ANY", amount: 1500, note: null }],
      }),
    );
  }

  const freeEvent = await createEvent({
    ownerId: organizerFree.id,
    quotaSource: "FREE_TRIAL",
    title: "はじめての写真散歩",
    sortDate: addDays(today, 10),
    location: "砧公園（東京都世田谷区）",
    venueName: "砧公園",
    capacity: 12,
    status: "PUBLISHED",
    schedules: [schedule(addDays(today, 10), "14:00", "16:00", 0)],
    plans: [{ name: "参加費", audience: "ANY", amount: 500, note: null }],
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

  // 撮影のやり直しで前回のロックが残ると、編集画面が 409 になる。いったん全部消す。
  await prisma.eventLock.deleteMany({});

  // 編集の排他ロック（共同幹事が編集中の状態）。編集画面を撮る催しには置かない。
  await prisma.eventLock.create({
    data: {
      eventId: takoyaki.event.id,
      lockedByUserId: coHost.id,
      lockHolderName: coHost.name,
      lockTokenHash: tokenHash(),
    },
  });

  // マイページの「新着」と、ヘッダーの札の未読数バッジを撮るための通知。
  // 未読は出席 1 件だけ（札のバッジは「1」になる）。それ以外は既読にし、
  // マイページの上限（4 件）を超える 6 件を置いて「通知一覧を見る」も撮れるようにする。
  await prisma.notification.deleteMany({ where: { userId: organizer.id } });
  const attendingRow =
    main.participants.find((row) => row.name === PARTICIPANT.name) ?? main.participants[0];
  const waitlistedRow =
    full.participants.find((row) => row.status === "WAITLISTED") ?? full.participants[0];
  const takoyakiAttending =
    takoyaki.participants.find((row) => row.status === "ATTENDING") ?? takoyaki.participants[0];
  const bonfireAttending =
    bonfire.participants.find((row) => row.status === "ATTENDING") ?? bonfire.participants[0];
  await prisma.notification.createMany({
    data: [
      {
        userId: organizer.id,
        eventId: main.event.id,
        participantId: attendingRow.id,
        kind: "RSVP_ATTENDING",
        title: "参加表明がありました",
        body: `${attendingRow.name} さんが「${main.event.title}」に出席します。`,
        dedupeKey: sha256(`ui-demo-notification-attending-${main.event.id}`),
        readAt: null,
        createdAt: new Date(Date.now() - 20 * 60 * 1000),
      },
      {
        userId: organizer.id,
        eventId: full.event.id,
        participantId: waitlistedRow.id,
        kind: "RSVP_WAITLISTED",
        title: "参加要望が届きました",
        body: `${waitlistedRow.name} さんが「${full.event.title}」の参加を希望しています。定員に達しているため、名簿から承認できます。`,
        dedupeKey: sha256(`ui-demo-notification-waitlisted-${full.event.id}`),
        readAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
        createdAt: new Date(Date.now() - 3 * 60 * 60 * 1000),
      },
      {
        userId: organizer.id,
        eventId: bonfire.event.id,
        participantId: bonfireAttending.id,
        kind: "RSVP_ATTENDING",
        title: "参加表明がありました",
        body: `${bonfireAttending.name} さんが「${bonfire.event.title}」に出席します。`,
        dedupeKey: sha256(`ui-demo-notification-attending-${bonfire.event.id}`),
        readAt: new Date(Date.now() - 26 * 60 * 60 * 1000),
        createdAt: new Date(Date.now() - 27 * 60 * 60 * 1000),
      },
      {
        userId: organizer.id,
        eventId: gohan.event.id,
        participantId: null,
        kind: "RSVP_WAITLISTED",
        title: "参加要望が届きました",
        body: `${PARTICIPANT.name} さんが「${gohan.event.title}」の参加を希望しています。定員に達しているため、名簿から承認できます。`,
        dedupeKey: sha256(`ui-demo-notification-waitlisted-${gohan.event.id}`),
        readAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
        createdAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000 - 60 * 60 * 1000),
      },
      {
        userId: organizer.id,
        eventId: takoyaki.event.id,
        participantId: takoyakiAttending.id,
        kind: "RSVP_ATTENDING",
        title: "参加表明がありました",
        body: `${takoyakiAttending.name} さんが「${takoyaki.event.title}」に出席します。`,
        dedupeKey: sha256(`ui-demo-notification-attending-${takoyaki.event.id}`),
        readAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000),
        createdAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000 - 30 * 60 * 1000),
      },
      {
        userId: organizer.id,
        eventId: main.event.id,
        participantId: null,
        kind: "RSVP_WAITLISTED",
        title: "参加要望が届きました",
        body: `${
          main.participants.find((row) => row.status === "WAITLISTED")?.name ?? attendingRow.name
        } さんが「${main.event.title}」の参加を希望しています。定員に達しているため、名簿から承認できます。`,
        dedupeKey: sha256(`ui-demo-notification-waitlisted-${main.event.id}`),
        readAt: new Date(Date.now() - 4 * 24 * 60 * 60 * 1000),
        createdAt: new Date(Date.now() - 4 * 24 * 60 * 60 * 1000 - 45 * 60 * 1000),
      },
    ],
  });

  const tokens = {
    organizer: await issueSessionToken(organizer),
    participant: await issueSessionToken(participant),
    // 参加履歴が空の状態を見るため、出欠を持たない会員も 1 人用意する。
    coHost: await issueSessionToken(coHost),
    // メールアドレス変更の確認画面だけに使う。
    verifyUser: await issueSessionToken(verifyUser),
    // 帯の 3 通り（8件プラン・公開し放題・未加入）を撮るため。
    organizerUnlimited: await issueSessionToken(organizerUnlimited),
    organizerFree: await issueSessionToken(organizerFree),
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
      organizerUnlimited: {
        email: ORGANIZER_UNLIMITED.email,
        password: ORGANIZER_UNLIMITED.password,
      },
      organizerFree: { email: ORGANIZER_FREE.email, password: ORGANIZER_FREE.password },
    },
    tokens,
    events: {
      main: main.event.id,
      full: full.event.id,
      closed: closed.event.id,
      takoyaki: takoyaki.event.id,
      lastMonth: lastMonth.event.id,
      draft: draft.event.id,
      craftMarket: craftMarket.event.id,
      halloween: halloween.event.id,
      bonfire: bonfire.event.id,
      gohan: gohan.event.id,
      reading: reading.event.id,
      christmas: christmas.event.id,
      djNight: djNight.event.id,
    },
    participantId: participant.id,
    organizerId: organizer.id,
    coHostId: coHost.id,
    receiptParticipant: main.participants[0].id,
    inviteCode: INVITE_CODE,
    emailVerifyToken: EMAIL_VERIFY_TOKEN,
    emailChangeTokens: EMAIL_CHANGE_TOKENS,
    // 確認後に表示されるアドレス。同期のたびにトークンを発行し直すので、
    // 同じアドレスを渡して、モックの見た目が実行ごとに変わらないようにする。
    emailChangeTargets: {
      "390": VERIFY_USER.confirmedEmail,
      "1280": VERIFY_USER.confirmedEmailWide,
    },
  };

  await mkdir(STORAGE, { recursive: true });
  await writeFile(OUT_FILE, `${JSON.stringify(result, null, 2)}\n`, "utf8");

  console.log("UI 確認用のデータを用意しました。");
  console.log(`  主催者: ${ORGANIZER.email} / ${ORGANIZER.password}`);
  console.log(`  参加者: ${PARTICIPANT.email} / ${PARTICIPANT.password}`);
  console.log(`  共同幹事: ${CO_HOST.email} / ${CO_HOST.password}`);
  console.log(`  確認用: ${VERIFY_USER.email} / ${VERIFY_USER.password}`);
  console.log(`  公開し放題: ${ORGANIZER_UNLIMITED.email} / ${ORGANIZER_UNLIMITED.password}`);
  console.log(`  未加入: ${ORGANIZER_FREE.email} / ${ORGANIZER_FREE.password}`);
  console.log(`  前回のデモ催し削除: ${removed.count} 件`);
  console.log("  催し:");
  console.log(`    秋の芋煮会（公開中・チラシ・定員40）: ${main.event.id}`);
  console.log(`    冬の焚き火会（満員・定員3）: ${full.event.id}`);
  console.log(`    写真展「夜の港」（受付停止）: ${closed.event.id}`);
  console.log(`    第3回 たこ焼きパーティー（チラシなし）: ${takoyaki.event.id}`);
  console.log(`    先月の芋煮会（過去日・領収書）: ${lastMonth.event.id}`);
  console.log(`    下書きの披露宴（下書き）: ${draft.event.id}`);
  console.log(`    手しごとの市 秋の道具市（過去日・和紙と藍）: ${craftMarket.event.id}`);
  console.log(`    ハロウィン おやこマルシェ（過去日・キャンディ）: ${halloween.event.id}`);
  console.log(`    川辺の焚き火ナイト（明日・夕暮れ）: ${bonfire.event.id}`);
  console.log(`    秋のゆるごはん会（公開中・羊皮紙）: ${gohan.event.id}`);
  console.log(`    朝の読書会（0円チケットで公開・チケット公開1件）: ${reading.event.id}`);
  console.log(`    クリスマス ダンスパフォーマンス（12月・羊皮紙）: ${christmas.event.id}`);
  console.log(`    DJナイト Vol.7（12月・ネオン）: ${djNight.event.id}`);
  console.log(`  招待コード: ${INVITE_CODE}`);
  console.log(`  書き出し: storage/ui-demo.json`);
  if (!tokens.organizer) {
    console.log("  JWT_SECRET が無いため、撮影用の Cookie は作りませんでした（--env-file=.env で実行してください）。");
  }
} finally {
  await prisma.$disconnect();
}
