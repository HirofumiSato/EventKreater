import { PrismaClient } from "@prisma/client";

const email = (process.argv[2] ?? "").trim().toLowerCase();
if (!email) {
  console.error("使い方: npm run admin:promote -- user@example.com");
  process.exit(1);
}

const prisma = new PrismaClient();
try {
  const existing = await prisma.user.findUnique({ where: { email } });
  if (!existing) {
    console.error("そのメールアドレスの会員はいません。先に会員登録してください。");
    process.exit(1);
  }
  if (!existing.passwordHash) {
    console.error("パスワードが無い会員は管理コンソールにログインできません。");
    process.exit(1);
  }
  await prisma.user.update({
    where: { email },
    data: { platformRole: "ADMIN" },
  });
  console.log(`${email} を管理者にしました。ログイン画面は /console/login です。`);
} finally {
  await prisma.$disconnect();
}
