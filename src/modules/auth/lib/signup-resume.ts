import { prisma } from "@/lib/prisma";
import { passwordHashMatches } from "@/modules/auth/lib/auth";

/**
 * 登録途中（メール確認のみ済み・電話番号が未確認）の再開。
 *
 * 会員行は電話番号の確認まで作られないため、`signup_intent` Cookie を失うと
 * ログインも電話番号の確認もできなくなる。ログインフォームで同じメールアドレスと
 * パスワードが入ったとき、`signup_intents` をパスワードで引き当てて続きへ戻す。
 * 会員の有無は応答で明かさない（一致した人にだけ続きを返す）。
 */

export type SignupResumeAudience = "ORGANIZER" | "PARTICIPANT";

export type SignupResumeResult =
  | { kind: "none" }
  | {
      kind: "email_pending";
      intent: { id: string; email: string; name: string; audience: SignupResumeAudience };
    }
  | { kind: "phone_pending"; intentId: string; audience: SignupResumeAudience };

/** 意向の延命幅。`beginSignupIntent` と同じ 24 時間。 */
const INTENT_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * ログインで会員のパスワードが合わなかったときに呼ぶ。
 *
 * - 退会していない会員に `passwordHash` があるときは `none`（通常の照合に任せる）
 * - 最新の意向のパスワードが一致しなければ `none`（意向の有無も応答に出さない）
 * - 一致したら、期限切れの意向だけ 24 時間へ延ばす（メール確認済みの事実は保持する）
 */
export async function resumeSignupIntent(input: {
  email: string;
  password: string;
  /** テストで時計を固定する。省略すると現在時刻。 */
  now?: Date;
}): Promise<SignupResumeResult> {
  const now = input.now ?? new Date();
  const email = input.email.trim().toLowerCase();

  // 会員と意向はまとめて引く。
  const [owner, intent] = await Promise.all([
    prisma.user.findFirst({
      where: { email, deletedAt: null },
      select: { passwordHash: true },
    }),
    prisma.signupIntent.findFirst({
      where: { email },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        email: true,
        name: true,
        audience: true,
        passwordHash: true,
        emailVerifiedAt: true,
        expiresAt: true,
      },
    }),
  ]);

  // パスワードを持つ会員がいるとき・意向が無いときも、ダミーで 1 回だけ照合する。
  // どの経路でも bcrypt の回数を 1 回にそろえ、会員や意向の有無を応答時間から読ませない。
  const storedHash = owner?.passwordHash ? null : (intent?.passwordHash ?? null);
  const matched = await passwordHashMatches(input.password, storedHash);
  // パスワードを持つ会員がいるなら、意向ではなく通常のログインの話。
  if (owner?.passwordHash || !intent || !matched) return { kind: "none" };

  // 期限が切れていても、パスワードが一致した本人には続きを許す。
  // 延ばすのは期限だけで、メール確認済みかどうか（emailVerifiedAt）は変えない。
  if (intent.expiresAt <= now) {
    await prisma.signupIntent.updateMany({
      where: { id: intent.id },
      data: { expiresAt: new Date(now.getTime() + INTENT_TTL_MS) },
    });
  }

  if (!intent.emailVerifiedAt) {
    return {
      kind: "email_pending",
      intent: {
        id: intent.id,
        email: intent.email,
        name: intent.name,
        audience: intent.audience,
      },
    };
  }
  return { kind: "phone_pending", intentId: intent.id, audience: intent.audience };
}
