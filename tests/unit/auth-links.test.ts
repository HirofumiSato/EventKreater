import { describe, expect, it } from "vitest";
import { loginUrl, phoneVerifyUrl, registerUrl } from "@/lib/auth-links";
import { safeNextPath } from "@/modules/auth/lib/google-auth";

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

  it("主催者の公開ページへ戻れる（統合したので /organizers も許可する）", () => {
    expect(safeNextPath("/organizers/u1")).toBe("/organizers/u1");
    expect(safeNextPath("/organizers/u1?month=2026-11")).toBe("/organizers/u1?month=2026-11");
  });

  it("許可していないパスは既定の着地へ落とす", () => {
    expect(safeNextPath("/console")).toBe("/mypage");
    expect(safeNextPath("/organizersx")).toBe("/mypage");
  });
});
