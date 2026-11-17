import { describe, expect, it } from "vitest";
import { safeNextPath } from "@/lib/next-path";

// 戻り先（`next`）の検証は、Google の認可・確認メール・認証画面が共有する。
// 許可した入口の配下だけを通し、外部サイトや別の画面へは飛ばさない。

describe("戻り先の検証", () => {
  it("許可した入口とその配下を通す", () => {
    expect(safeNextPath("/mypage")).toBe("/mypage");
    expect(safeNextPath("/organizer/events/new?ref=abc")).toBe("/organizer/events/new?ref=abc");
    expect(safeNextPath("/participant/events/abc")).toBe("/participant/events/abc");
    expect(safeNextPath("/events/abc?rsvp=1")).toBe("/events/abc?rsvp=1");
    expect(safeNextPath("/organizers/u1")).toBe("/organizers/u1");
  });

  it("入口そのものと、その直下だけを通す（前方一致のなりすましを弾く）", () => {
    expect(safeNextPath("/events")).toBe("/events");
    expect(safeNextPath("/organizersx")).toBe("/mypage");
    expect(safeNextPath("/mypages")).toBe("/mypage");
  });

  it("許可していない画面は既定の着地へ落とす", () => {
    expect(safeNextPath("/console")).toBe("/mypage");
    expect(safeNextPath("/auth/register")).toBe("/mypage");
    // 入口ごとの既定を渡せる（参加者は参加者ホーム）。
    expect(safeNextPath("/console", "/participant")).toBe("/participant");
  });

  it("外部サイト・上位への移動・バックスラッシュを弾く", () => {
    expect(safeNextPath("//evil.example.com")).toBe("/mypage");
    expect(safeNextPath("https://evil.example.com")).toBe("/mypage");
    expect(safeNextPath("/organizer/../console")).toBe("/mypage");
    expect(safeNextPath("/organizer/%2e%2e/console")).toBe("/mypage");
    expect(safeNextPath("/organizer\\events")).toBe("/mypage");
    // 二重エンコードで検査をすり抜けさせない。
    expect(safeNextPath("%2F%2Fevil.example.com")).toBe("/mypage");
  });

  it("空・不正なエンコードは既定へ落とす", () => {
    expect(safeNextPath("")).toBe("/mypage");
    expect(safeNextPath(null)).toBe("/mypage");
    expect(safeNextPath(undefined)).toBe("/mypage");
    expect(safeNextPath("%E0%A4%A")).toBe("/mypage");
  });
});
