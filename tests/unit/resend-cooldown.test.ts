import { describe, expect, it } from "vitest";
import { RESEND_COOLDOWN_MS, remainingCooldownSeconds } from "@/modules/auth/lib/resend";

describe("確認コードの再送クールダウン", () => {
  const sentAt = 1_000_000;

  it("送信した直後は 60 秒待つ", () => {
    expect(remainingCooldownSeconds(sentAt, sentAt)).toBe(60);
    expect(RESEND_COOLDOWN_MS).toBe(60_000);
  });

  it("1 秒経つと残りは 59 秒になる", () => {
    expect(remainingCooldownSeconds(sentAt, sentAt + 1_000)).toBe(59);
  });

  it("残り 1 秒未満でも 1 を返す（押せるのは 0 になってから）", () => {
    expect(remainingCooldownSeconds(sentAt, sentAt + 59_500)).toBe(1);
  });

  it("60 秒に達したら 0 になる", () => {
    expect(remainingCooldownSeconds(sentAt, sentAt + 60_000)).toBe(0);
    expect(remainingCooldownSeconds(sentAt, sentAt + 61_000)).toBe(0);
  });

  it("送信していなければ待たない", () => {
    expect(remainingCooldownSeconds(null, sentAt)).toBe(0);
  });

  it("端末の時計が戻ってもクールダウンの長さを超えない", () => {
    expect(remainingCooldownSeconds(sentAt + 5_000, sentAt)).toBe(60);
  });

  it("窓の長さは変えられる", () => {
    expect(remainingCooldownSeconds(sentAt, sentAt, 5_000)).toBe(5);
    expect(remainingCooldownSeconds(sentAt, sentAt + 4_000, 5_000)).toBe(1);
    expect(remainingCooldownSeconds(sentAt, sentAt + 5_000, 5_000)).toBe(0);
  });
});
