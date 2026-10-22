import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { createHash, randomBytes } from "crypto";

/**
 * 参加者カレンダーの動作確認用アカウントと出欠データを作る。
 * 何度実行しても確認用のイベントを作り直すので、カレンダーの状態が増え続けない。
 *
 *   node scripts/seed-demo-participant.mjs
 */

const ACCOUNT = {
  email: "demo.participant@example.com",
  // 漏えい済みパスワードの照合（Have I Been Pwned）に当たらない値にする。
  // 当たる値にすると、登録モードの送信が 400 で止まる。
  password: "EventKreater-Demo-2026!",
  name: "確認用 参加者",
  phone: "+8190000000099",
};

const TITLE_PREFIX = "[確認用]";

const TOKYO_OFFSET_MS = 9 * 60 * 60 * 1000;

/** 日本時間の今日を `YYYY-MM-DD` で返す。 */
function todayInTokyo() {
  return new Date(Date.now() + TOKYO_OFFSET_MS).toISOString().slice(0, 10);
}

/** `YYYY-MM-DD` に日数を足す。 */
function addDays(date, days) {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

function toDate(date) {
  return new Date(`${date}T00:00:00.000Z`);
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

function rsvpTokenHash() {
  return createHash("sha256").update(randomBytes(24)).digest("hex");
}

const prisma = new PrismaClient();

try {
  const now = new Date();
  const passwordHash = await bcrypt.hash(ACCOUNT.password, 12);

  const user = await prisma.user.upsert({
    where: { email: ACCOUNT.email },
    create: {
      email: ACCOUNT.email,
      name: ACCOUNT.name,
      passwordHash,
      emailVerifiedAt: now,
      phoneE164: ACCOUNT.phone,
      phoneVerifiedAt: now,
      quota: { create: {} },
    },
    update: {
      name: ACCOUNT.name,
      passwordHash,
      emailVerifiedAt: now,
      phoneE164: ACCOUNT.phone,
      phoneVerifiedAt: now,
      deletedAt: null,
    },
  });

  await prisma.userUsageQuota.upsert({
    where: { userId: user.id },
    create: { userId: user.id },
    update: {},
  });

  // 前回作った確認用イベントを消してから作り直す（出欠もカスケードで消える）。
  const removed = await prisma.event.deleteMany({
    where: { title: { startsWith: TITLE_PREFIX } },
  });

  const today = todayInTokyo();
  const lastMonth = addDays(`${today.slice(0, 8)}01`, -1);

  /** 確認用のイベントを1件作り、出欠も1件作る。 */
  async function seedParticipation(input) {
    const event = await prisma.event.create({
      data: {
        title: `${TITLE_PREFIX}${input.title}`,
        sortDate: toDate(input.sortDate),
        location: input.location,
        status: "PUBLISHED",
        visibility: "UNLISTED",
        // 幹事は誰でもない確認用の行。参加者カレンダーには出欠だけが効く。
        organizers: { create: { role: "OWNER" } },
        schedules: { create: input.schedules },
        pricePlans: {
          create: [{ name: "一般", audience: "ANY", amount: input.amount ?? 3000, sortOrder: 0 }],
        },
      },
      include: { schedules: { orderBy: { sortOrder: "asc" } } },
    });

    const chosen = input.chooseScheduleIndex === null ? null : event.schedules[input.chooseScheduleIndex ?? 0];
    await prisma.participant.create({
      data: {
        eventId: event.id,
        userId: user.id,
        rsvpTokenHash: rsvpTokenHash(),
        name: ACCOUNT.name,
        status: input.status,
        scheduleId: chosen?.id ?? null,
        comment: input.comment ?? null,
      },
    });

    return {
      title: event.title,
      status: input.status,
      shownOn: chosen ? chosen.eventDate.toISOString().slice(0, 10) : input.sortDate,
      candidates: event.schedules.map((row) => row.eventDate.toISOString().slice(0, 10)),
    };
  }

  const created = [];

  // 今日: 出席。同じ日に欠席も置いて、並び順と色の違いを見る。
  // 4件目を足して、セルに入りきらないときの「+1」も確認できるようにする。
  created.push(
    await seedParticipation({
      title: "今日の懇親会",
      sortDate: today,
      location: "渋谷の居酒屋",
      schedules: [schedule(today, "18:00", "21:00", 0)],
      status: "ATTENDING",
      comment: "19時ごろ着きます。",
    }),
  );
  created.push(
    await seedParticipation({
      title: "今日の朝会（欠席）",
      sortDate: today,
      location: "オンライン",
      schedules: [schedule(today, "09:00", "10:00", 0)],
      status: "DECLINED",
    }),
  );
  created.push(
    await seedParticipation({
      title: "今日の昼休み",
      sortDate: today,
      location: "社食",
      schedules: [schedule(today, "12:00", "13:00", 0)],
      status: "ATTENDING",
    }),
  );
  created.push(
    await seedParticipation({
      title: "今日の夜の勉強会",
      sortDate: today,
      location: "会議室",
      schedules: [schedule(today, "20:00", "22:00", 0)],
      status: "ATTENDING",
    }),
  );

  // 複数日程: 2日目の日程を選んだので、1日目には出ないこと。
  created.push(
    await seedParticipation({
      title: "複数日程の催し（2日目を選択）",
      sortDate: addDays(today, 6),
      location: "市民ホール",
      schedules: [
        schedule(addDays(today, 6), "19:00", "21:30", 0),
        schedule(addDays(today, 12), "14:00", "16:00", 1),
      ],
      chooseScheduleIndex: 1,
      status: "ATTENDING",
    }),
  );

  // 日程を選ばずに回答: 代表日（sortDate）に置かれること。
  created.push(
    await seedParticipation({
      title: "日程を選ばなかった催し",
      sortDate: addDays(today, 9),
      location: "公園",
      schedules: [schedule(addDays(today, 20), "10:00", "12:00", 0)],
      chooseScheduleIndex: null,
      status: "ATTENDING",
    }),
  );

  // 日跨ぎ: 「21:00〜翌02:00」と出ること。
  created.push(
    await seedParticipation({
      title: "日跨ぎの催し",
      sortDate: addDays(today, 2),
      location: "ライブハウス",
      schedules: [schedule(addDays(today, 2), "21:00", "02:00", 0)],
      status: "ATTENDING",
    }),
  );

  // 先月: 前月へ移動したときに出ること。
  created.push(
    await seedParticipation({
      title: "先月の催し",
      sortDate: lastMonth,
      location: "公民館",
      schedules: [schedule(lastMonth, "13:00", "15:00", 0)],
      status: "ATTENDING",
    }),
  );

  console.log("確認用の参加者を用意しました。");
  console.log(`  メール: ${ACCOUNT.email}`);
  console.log(`  パスワード: ${ACCOUNT.password}`);
  console.log(`  ログイン: /participant/login （参加者の入口）`);
  console.log(`  前回の確認用イベント削除: ${removed.count} 件`);
  console.log("出欠データ:");
  for (const row of created) {
    console.log(
      `  ${row.title} / ${row.status} / 表示日 ${row.shownOn} / 候補日 ${row.candidates.join(", ")}`,
    );
  }
  console.log("パスワードのあと、確認番号が開発サーバーのログに [sms] で出ます。");
} finally {
  await prisma.$disconnect();
}
