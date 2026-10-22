import { describe, expect, it } from "vitest";
import { loginUrl, phoneVerifyUrl, registerUrl } from "@/lib/auth-links";

describe("認証への導線", () => {
  it("戻り先をエンコードして mode を付ける", () => {
    expect(registerUrl("/organizer/events")).toBe(
      "/auth/register?mode=register&next=%2Forganizer%2Fevents",
    );
    expect(loginUrl("/mypage")).toBe("/auth/register?mode=login&next=%2Fmypage");
  });

  it("戻り先のクエリも保つ（登録後の完了トースト用）", () => {
    expect(registerUrl("/organizer/events?registered=1")).toBe(
      "/auth/register?mode=register&next=%2Forganizer%2Fevents%3Fregistered%3D1",
    );
  });

  it("電話番号の確認へ進んでも戻り先を保つ", () => {
    expect(phoneVerifyUrl("/organizer/events/new?ref=abc")).toBe(
      "/auth/register?step=phone&next=%2Forganizer%2Fevents%2Fnew%3Fref%3Dabc",
    );
  });
});
