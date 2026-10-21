import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const ACCOUNTS = [
  {
    email: "organizer@example.com",
    password: "Testpass123!",
    name: "初期主催者",
    phone: "+8190000000001",
    role: "MEMBER",
    label: "ローカル主催者",
    login: "/auth/register （ログインに切り替え）",
  },
  {
    email: "admin@example.com",
    password: "Adminpass123!",
    name: "初期管理者",
    phone: "+8190000000002",
    role: "ADMIN",
    label: "ローカル管理者",
    login: "/console/login",
  },
];

const prisma = new PrismaClient();

try {
  const now = new Date();

  for (const account of ACCOUNTS) {
    const passwordHash = await bcrypt.hash(account.password, 12);

    const user = await prisma.user.upsert({
      where: { email: account.email },
      create: {
        email: account.email,
        name: account.name,
        passwordHash,
        emailVerifiedAt: now,
        phoneE164: account.phone,
        phoneVerifiedAt: now,
        platformRole: account.role,
        quota: { create: {} },
      },
      update: {
        name: account.name,
        passwordHash,
        emailVerifiedAt: now,
        phoneE164: account.phone,
        phoneVerifiedAt: now,
        platformRole: account.role,
      },
    });

    await prisma.userUsageQuota.upsert({
      where: { userId: user.id },
      create: { userId: user.id },
      update: {},
    });

    console.log(`${account.label}を用意しました。`);
    console.log(`  メール: ${account.email}`);
    console.log(`  パスワード: ${account.password}`);
    console.log(`  ログイン画面: ${account.login}`);
  }

  console.log("パスワードのあと、確認番号が開発サーバーのログに [sms] または [mail] で出ます。");
} finally {
  await prisma.$disconnect();
}
