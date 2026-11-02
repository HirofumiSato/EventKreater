import { randomBytes } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { loadReferralInvite } from "@/modules/account/lib/referral-invite";
import { cleanup, uniqueEmail } from "./helpers";

const describeDb = process.env.TEST_DATABASE_URL ? describe : describe.skip;

/** 紹介コードの形（英数 8 文字）。他の結合テストとぶつからないよう、テストごとに作り直す。 */
const CODE_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

function newCode(): string {
  return Array.from(randomBytes(8), (byte) => CODE_ALPHABET[byte % CODE_ALPHABET.length]).join("");
}

/**
 * 紹介リンクの着地ページ（`/invite/<code>`）が引く紹介者。
 *
 * 画面は無効なコードでも 404 にしないため、ここは「引けたか」と「何を出すか」だけを持つ。
 * 公開範囲は公開プロフィールと同じで、非公開なら名前とアイコン以外を出さない。
 */
describeDb("紹介リンクの照会（結合）", () => {
  const userIds: string[] = [];

  async function member(options: { code?: string; published?: boolean } = {}) {
    const created = await prisma.user.create({
      data: {
        email: uniqueEmail("invite"),
        name: "紹介する人",
        phoneVerifiedAt: new Date(),
        referralCode: options.code ?? null,
        quota: { create: {} },
        organizerProfile: options.published
          ? {
              create: {
                isPublished: true,
                headline: "月いちの集まり",
                bio: "はじめての方も歓迎します。",
                themeId: "sage",
              },
            }
          : undefined,
      },
    });
    userIds.push(created.id);
    return created;
  }

  afterEach(async () => {
    await cleanup({ eventIds: [], userIds });
    userIds.length = 0;
  });

  it("公開プロフィールの会員は、名前・肩書き・自己紹介・テーマを返す", async () => {
    const code = newCode();
    const referrer = await member({ code, published: true });

    const invite = await loadReferralInvite(code);

    expect(invite).toEqual({
      userId: referrer.id,
      name: "紹介する人",
      headline: "月いちの集まり",
      bio: "はじめての方も歓迎します。",
      avatarUrl: null,
      themeId: "sage",
    });
  });

  it("プロフィールが非公開なら、名前だけを出して本文は出さない", async () => {
    const code = newCode();
    await member({ code });

    const invite = await loadReferralInvite(code);

    expect(invite?.name).toBe("紹介する人");
    expect(invite?.headline).toBeNull();
    expect(invite?.bio).toBeNull();
    expect(invite?.themeId).toBeNull();
  });

  it("コードの前後の空白は落として引く", async () => {
    const code = newCode();
    await member({ code });

    expect((await loadReferralInvite(`  ${code} `))?.name).toBe("紹介する人");
  });

  it("形が違うコードは、DB を引かずに null", async () => {
    expect(await loadReferralInvite("short")).toBeNull();
    expect(await loadReferralInvite("x7Kd2-Qp")).toBeNull();
    expect(await loadReferralInvite("")).toBeNull();
  });

  it("形は合っていても、会員がいなければ null", async () => {
    expect(await loadReferralInvite(newCode())).toBeNull();
  });

  it("退会した会員のコードは null（リンクは無効として扱う）", async () => {
    const code = newCode();
    const referrer = await member({ code });
    await prisma.user.update({
      where: { id: referrer.id },
      data: { deletedAt: new Date() },
    });

    expect(await loadReferralInvite(code)).toBeNull();
  });
});
