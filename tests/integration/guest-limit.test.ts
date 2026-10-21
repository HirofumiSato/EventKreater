import { afterEach, describe, expect, it } from "vitest";
import { assertGuestCanCreate } from "@/modules/events/lib/guest-limit";
import { ProblemDetailException } from "@/lib/exceptions";
import { cleanup, seedEvent } from "./helpers";

const describeDb = process.env.TEST_DATABASE_URL ? describe : describe.skip;

describeDb("assertGuestCanCreate（結合）", () => {
  const eventIds: string[] = [];
  const userIds: string[] = [];

  afterEach(async () => {
    await cleanup({ eventIds, userIds });
    eventIds.length = 0;
    userIds.length = 0;
  });

  it("初回は通す", async () => {
    await expect(assertGuestCanCreate(["hash-first"])).resolves.toBeUndefined();
  });

  it("筆頭幹事として1件持っていれば2件目を断る", async () => {
    const event = await seedEvent({ guestTokenHash: "hash-owner", role: "OWNER" });
    eventIds.push(event.id);

    try {
      await assertGuestCanCreate(["hash-owner"]);
      throw new Error("例外が出ませんでした");
    } catch (error) {
      expect(error).toBeInstanceOf(ProblemDetailException);
      const problem = error as ProblemDetailException;
      expect(problem.status).toBe(403);
      expect(problem.type).toBe("probs/register-required");
      expect(problem.extras.error).toBe("REGISTER_REQUIRED");
    }
  });

  it("共同幹事だけなら数えない（自分のイベントはまだ作れる）", async () => {
    const event = await seedEvent({ guestTokenHash: "hash-cohost", role: "CO_HOST" });
    eventIds.push(event.id);

    await expect(assertGuestCanCreate(["hash-cohost"])).resolves.toBeUndefined();
  });

  it("削除済みでも作成済みとして数える", async () => {
    const event = await seedEvent({ guestTokenHash: "hash-deleted", role: "OWNER", isDeleted: true });
    eventIds.push(event.id);

    await expect(assertGuestCanCreate(["hash-deleted"])).rejects.toBeInstanceOf(ProblemDetailException);
  });
});
