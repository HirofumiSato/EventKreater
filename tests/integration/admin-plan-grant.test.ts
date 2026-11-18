import { afterEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { searchAdminUsers, setUserPlanGrant } from "@/modules/admin/lib/directory";
import { cleanup, seedEvent, uniqueEmail } from "./helpers";

const describeDb = process.env.TEST_DATABASE_URL ? describe : describe.skip;

interface MemberOptions {
  name?: string;
  platformRole?: "ADMIN" | "MEMBER";
  /** 利用枠の行を作るか。付与の upsert を見るために、行なしの会員も作れるようにする。 */
  withQuota?: boolean;
  deletedAt?: Date | null;
}

async function createMember(options: MemberOptions = {}) {
  const withQuota = options.withQuota ?? true;
  return prisma.user.create({
    data: {
      email: uniqueEmail("admin-plan"),
      name: options.name ?? "テスト会員",
      platformRole: options.platformRole ?? "MEMBER",
      deletedAt: options.deletedAt ?? null,
      ...(withQuota ? { quota: { create: {} } } : {}),
    },
  });
}

/**
 * 運営付与・デモ付与の公開し放題（結合）。
 *
 * 管理コンソール `/console/users` の「付与」「デモ付与」「解除」が呼ぶ `setUserPlanGrant` を直に確かめる。
 * 判定はどちらも `granted_plan = 'UNLIMITED'` の 1 本で、Stripe の契約（`subscription_plan` など）には
 * 触らず、付与した人・日時・種別だけを残す。
 */
describeDb("運営付与・デモ付与の公開し放題（結合）", () => {
  const eventIds: string[] = [];
  const userIds: string[] = [];

  afterEach(async () => {
    await cleanup({ eventIds, userIds });
    eventIds.length = 0;
    userIds.length = 0;
  });

  it("付与すると granted_plan と付与者・日時が入り、管理一覧にも同じ印が出る", async () => {
    const admin = await createMember({ name: "運営の管理者", platformRole: "ADMIN" });
    const member = await createMember();
    userIds.push(admin.id, member.id);

    const before = Date.now();
    const result = await setUserPlanGrant(admin.id, member.id, "UNLIMITED", "OPERATOR");

    expect(result.id).toBe(member.id);
    expect(result.grantedUnlimited).toBe(true);
    expect(result.grantedKind).toBe("OPERATOR");
    expect(result.grantedAt).not.toBeNull();
    expect(result.grantedByName).toBe("運営の管理者");

    const quota = await prisma.userUsageQuota.findUniqueOrThrow({ where: { userId: member.id } });
    expect(quota.grantedPlan).toBe("UNLIMITED");
    expect(quota.grantedKind).toBe("OPERATOR");
    expect(quota.grantedPlanBy).toBe(admin.id);
    expect(quota.grantedPlanAt?.getTime()).toBeGreaterThanOrEqual(before);
    // 付与は Stripe の契約とは独立。契約の列は動かさない。
    expect(quota.subscriptionStatus).toBe("NONE");
    expect(quota.subscriptionPlan).toBe("NONE");

    // 管理コンソールの一覧も、付与中の印と付与者を返す。
    const { users } = await searchAdminUsers(member.email, 0);
    const row = users.find((item) => item.id === member.id);
    expect(row?.grantedUnlimited).toBe(true);
    expect(row?.grantedKind).toBe("OPERATOR");
    expect(row?.grantedAt).toBe(result.grantedAt);
    expect(row?.grantedByName).toBe("運営の管理者");
  });

  it("デモ付与すると granted_kind に DEMO が入り、管理一覧にもデモの種別が出る", async () => {
    const admin = await createMember({ name: "運営の管理者", platformRole: "ADMIN" });
    const member = await createMember();
    userIds.push(admin.id, member.id);

    const result = await setUserPlanGrant(admin.id, member.id, "UNLIMITED", "DEMO");

    expect(result.grantedUnlimited).toBe(true);
    expect(result.grantedKind).toBe("DEMO");
    expect(result.grantedAt).not.toBeNull();
    expect(result.grantedByName).toBe("運営の管理者");

    // 公開可否の判定は運営付与と同じ列（granted_plan）で、種別だけが DEMO になる。
    const quota = await prisma.userUsageQuota.findUniqueOrThrow({ where: { userId: member.id } });
    expect(quota.grantedPlan).toBe("UNLIMITED");
    expect(quota.grantedKind).toBe("DEMO");
    expect(quota.grantedPlanBy).toBe(admin.id);
    expect(quota.grantedPlanAt).not.toBeNull();
    // デモも Stripe の契約ではない。契約の列は動かさない。
    expect(quota.subscriptionStatus).toBe("NONE");
    expect(quota.subscriptionPlan).toBe("NONE");

    const { users } = await searchAdminUsers(member.email, 0);
    const row = users.find((item) => item.id === member.id);
    expect(row?.grantedUnlimited).toBe(true);
    expect(row?.grantedKind).toBe("DEMO");
    expect(row?.grantedAt).toBe(result.grantedAt);
    expect(row?.grantedByName).toBe("運営の管理者");
  });

  it("解除すると4列が NULL に戻り、公開済みのイベントは残る", async () => {
    const admin = await createMember({ platformRole: "ADMIN" });
    const member = await createMember();
    userIds.push(admin.id, member.id);
    const published = await seedEvent({
      userId: member.id,
      status: "PUBLISHED",
      quotaSource: "SUBSCRIPTION",
    });
    eventIds.push(published.id);
    await setUserPlanGrant(admin.id, member.id, "UNLIMITED", "DEMO");

    const result = await setUserPlanGrant(admin.id, member.id, "NONE");

    expect(result.grantedUnlimited).toBe(false);
    // 種別が無くなった行は運営付与として読む（付与なしなので表示には使わない）。
    expect(result.grantedKind).toBe("OPERATOR");
    expect(result.grantedAt).toBeNull();
    expect(result.grantedByName).toBeNull();

    const quota = await prisma.userUsageQuota.findUniqueOrThrow({ where: { userId: member.id } });
    expect(quota.grantedPlan).toBeNull();
    expect(quota.grantedKind).toBeNull();
    expect(quota.grantedPlanBy).toBeNull();
    expect(quota.grantedPlanAt).toBeNull();
    // 解除は即時に効くが、付与中に公開した催しは消さない。
    const event = await prisma.event.findUniqueOrThrow({ where: { id: published.id } });
    expect(event.status).toBe("PUBLISHED");
    expect(event.isDeleted).toBe(false);

    const { users } = await searchAdminUsers(member.email, 0);
    const row = users.find((item) => item.id === member.id);
    expect(row?.grantedUnlimited).toBe(false);
    expect(row?.grantedKind).toBe("OPERATOR");
    expect(row?.grantedAt).toBeNull();
    expect(row?.grantedByName).toBeNull();
  });

  it("退会済みの会員は 400 で止まり、付与は変わらない", async () => {
    const admin = await createMember({ platformRole: "ADMIN" });
    const member = await createMember({ deletedAt: new Date("2026-10-01T00:00:00.000Z") });
    userIds.push(admin.id, member.id);

    await expect(setUserPlanGrant(admin.id, member.id, "UNLIMITED", "OPERATOR")).rejects.toMatchObject({
      status: 400,
    });

    const quota = await prisma.userUsageQuota.findUniqueOrThrow({ where: { userId: member.id } });
    expect(quota.grantedPlan).toBeNull();
  });

  it("利用枠の行が無い会員でも、付与のときに行を作る（upsert）", async () => {
    const admin = await createMember({ platformRole: "ADMIN" });
    const member = await createMember({ withQuota: false });
    userIds.push(admin.id, member.id);
    expect(await prisma.userUsageQuota.findUnique({ where: { userId: member.id } })).toBeNull();

    const result = await setUserPlanGrant(admin.id, member.id, "UNLIMITED", "OPERATOR");

    expect(result.grantedUnlimited).toBe(true);
    const quota = await prisma.userUsageQuota.findUniqueOrThrow({ where: { userId: member.id } });
    expect(quota.grantedPlan).toBe("UNLIMITED");
    expect(quota.grantedKind).toBe("OPERATOR");
    expect(quota.grantedPlanBy).toBe(admin.id);
    // 行を作っただけで、Stripe の契約は初期値のまま。
    expect(quota.subscriptionStatus).toBe("NONE");
  });

  it("会員が見つからなければ 404", async () => {
    const admin = await createMember({ platformRole: "ADMIN" });
    userIds.push(admin.id);

    await expect(
      setUserPlanGrant(admin.id, "00000000-0000-4000-8000-000000000000", "UNLIMITED", "OPERATOR"),
    ).rejects.toMatchObject({ status: 404 });
  });
});
