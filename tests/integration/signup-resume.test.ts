import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { hashPassword } from "@/modules/auth/lib/auth";
import { beginSignupIntent } from "@/modules/auth/lib/verification";
import { resumeSignupIntent } from "@/modules/auth/lib/signup-resume";

const describeDb = process.env.TEST_DATABASE_URL ? describe : describe.skip;

/** 意向の延命幅（`beginSignupIntent` と同じ 24 時間）。 */
const INTENT_TTL_MS = 24 * 60 * 60 * 1000;

/** 照合に使うパスワード。登録画面と同じく 1 つのハッシュを使い回す。 */
const PASSWORD = "Test-passw0rd-2026";

/** テストごとに衝突しないメールアドレスを作る。 */
let seq = 0;
function uniqueEmail(label: string): string {
  seq += 1;
  return `resume-${label}-${process.pid}-${Date.now()}-${seq}-${Math.random().toString(16).slice(2)}@example.invalid`;
}

describeDb("登録途中の再開（結合）", () => {
  const emails: string[] = [];
  let passwordHash = "";

  beforeAll(async () => {
    // ハッシュづくりは 1 回だけ（bcrypt の費用をテストごとに払わない）。
    passwordHash = await hashPassword(PASSWORD);
  });

  afterEach(async () => {
    if (emails.length > 0) {
      await prisma.signupIntent.deleteMany({ where: { email: { in: emails } } });
      await prisma.user.deleteMany({ where: { email: { in: emails } } });
      emails.length = 0;
    }
  });

  function emailOf(label: string): string {
    const email = uniqueEmail(label);
    emails.push(email);
    return email;
  }

  it("確認済みの意向は、パスワードが一致すると phone_pending を返す", async () => {
    const email = emailOf("verified");
    const intent = await beginSignupIntent({
      email,
      name: "確認済み",
      passwordHash,
      emailVerifiedAt: new Date(),
      audience: "PARTICIPANT",
    });

    const result = await resumeSignupIntent({ email, password: PASSWORD });

    expect(result).toEqual({
      kind: "phone_pending",
      intentId: intent.id,
      audience: "PARTICIPANT",
    });
  });

  it("未確認の意向は、パスワードが一致すると email_pending を返し、会員を作らない", async () => {
    const email = emailOf("pending");
    const intent = await beginSignupIntent({
      email,
      name: "未確認",
      passwordHash,
      audience: "ORGANIZER",
    });

    const result = await resumeSignupIntent({ email, password: PASSWORD });

    expect(result).toEqual({
      kind: "email_pending",
      intent: { id: intent.id, email, name: "未確認", audience: "ORGANIZER" },
    });
    expect(await prisma.user.findUnique({ where: { email } })).toBeNull();
  });

  it("期限切れの意向も、パスワードが一致すれば期限だけ延ばして続けられる", async () => {
    const email = emailOf("expired");
    const verifiedAt = new Date("2026-10-01T00:00:00.000Z");
    const intent = await beginSignupIntent({
      email,
      name: "期限切れ",
      passwordHash,
      emailVerifiedAt: verifiedAt,
    });
    await prisma.signupIntent.update({
      where: { id: intent.id },
      data: { expiresAt: new Date(Date.now() - 60 * 60 * 1000) },
    });

    const now = new Date();
    const result = await resumeSignupIntent({ email, password: PASSWORD, now });

    expect(result.kind).toBe("phone_pending");
    const stored = await prisma.signupIntent.findUniqueOrThrow({ where: { id: intent.id } });
    // 期限は現在時刻から 24 時間へ延びる。
    expect(stored.expiresAt.getTime()).toBe(now.getTime() + INTENT_TTL_MS);
    // メール確認済みの事実は変えない（未確認へ戻さない）。
    expect(stored.emailVerifiedAt?.toISOString()).toBe(verifiedAt.toISOString());
  });

  it("パスワードが違えば none を返す", async () => {
    const email = emailOf("mismatch");
    await beginSignupIntent({
      email,
      name: "不一致",
      passwordHash,
      emailVerifiedAt: new Date(),
    });

    await expect(resumeSignupIntent({ email, password: "wrong-password" })).resolves.toEqual({
      kind: "none",
    });
  });

  it("対応する意向が無ければ none を返す", async () => {
    const email = emailOf("missing");

    await expect(resumeSignupIntent({ email, password: PASSWORD })).resolves.toEqual({
      kind: "none",
    });
  });

  it("パスワードを持つ会員がいるときは none を返す（通常の照合に任せる）", async () => {
    const email = emailOf("member");
    await prisma.user.create({
      data: { email, name: "既存会員", passwordHash, emailVerifiedAt: new Date() },
    });
    // 意向が残っていても、会員行が優先される。
    await beginSignupIntent({ email, name: "既存会員", passwordHash, emailVerifiedAt: new Date() });

    await expect(resumeSignupIntent({ email, password: PASSWORD })).resolves.toEqual({
      kind: "none",
    });
  });

  it("パスワードを持たない意向は none を返す", async () => {
    const email = emailOf("no-password");
    await beginSignupIntent({ email, name: "Google から", googleSub: `google-${email}` });

    await expect(resumeSignupIntent({ email, password: PASSWORD })).resolves.toEqual({
      kind: "none",
    });
  });
});
