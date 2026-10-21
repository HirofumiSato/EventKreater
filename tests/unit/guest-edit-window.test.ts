import { describe, expect, it } from "vitest";
import { assertGuestEditWindow, GUEST_EDIT_WINDOW_MS, type AuthContext } from "@/modules/auth/lib/guards";
import { ProblemDetailException } from "@/lib/exceptions";

const guest: AuthContext = { userId: null, guestTokenHash: "hash", role: "OWNER" };
const member: AuthContext = { userId: "user-1", guestTokenHash: null, role: "OWNER" };
const createdAt = new Date("2026-10-01T00:00:00.000Z");

describe("assertGuestEditWindow", () => {
  it("作成から24時間ちょうどまでは編集できる", () => {
    expect(() => assertGuestEditWindow(guest, createdAt, createdAt.getTime() + GUEST_EDIT_WINDOW_MS)).not.toThrow();
  });

  it("24時間を1ミリ秒でも過ぎたら REGISTER_REQUIRED", () => {
    try {
      assertGuestEditWindow(guest, createdAt, createdAt.getTime() + GUEST_EDIT_WINDOW_MS + 1);
      throw new Error("例外が出ませんでした");
    } catch (error) {
      expect(error).toBeInstanceOf(ProblemDetailException);
      const problem = error as ProblemDetailException;
      expect(problem.status).toBe(403);
      expect(problem.type).toBe("probs/register-required");
      expect(problem.extras.error).toBe("REGISTER_REQUIRED");
    }
  });

  it("会員はいつでも編集できる", () => {
    expect(() =>
      assertGuestEditWindow(member, createdAt, createdAt.getTime() + GUEST_EDIT_WINDOW_MS * 10),
    ).not.toThrow();
  });
});
