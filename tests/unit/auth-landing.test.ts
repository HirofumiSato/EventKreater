import { describe, expect, it } from "vitest";
import {
  isSwitchingAccount,
  phoneStepHref,
  resolveAuthLanding,
  resolveSessionDestination,
} from "@/modules/auth/lib/auth-landing";

describe("ログイン済みセッションの着地", () => {
  it("戻り先の指定があれば、役割に関係なくそのパスへ返す", () => {
    expect(
      resolveAuthLanding({
        audience: "organizer",
        hasExplicitNext: true,
        nextPath: "/organizer/events",
        platformRole: "ADMIN",
      }),
    ).toBe("/organizer/events");
  });

  it("管理者が主催者の入口を戻り先なしで開いたら管理コンソールへ送る", () => {
    expect(
      resolveAuthLanding({
        audience: "organizer",
        hasExplicitNext: false,
        nextPath: "/mypage",
        platformRole: "ADMIN",
      }),
    ).toBe("/console");
  });

  it("参加者の入口では、管理者も参加者ホームへ送る", () => {
    expect(
      resolveAuthLanding({
        audience: "participant",
        hasExplicitNext: false,
        nextPath: "/participant",
        platformRole: "ADMIN",
      }),
    ).toBe("/participant");
  });

  it("会員は主催者の入口からマイページへ送る", () => {
    expect(
      resolveAuthLanding({
        audience: "organizer",
        hasExplicitNext: false,
        nextPath: "/mypage",
        platformRole: "MEMBER",
      }),
    ).toBe("/mypage");
  });

  it("電話番号が未確認なら、ログインは済んでいるので確認画面だけを出す", () => {
    expect(
      resolveSessionDestination({
        audience: "organizer",
        basePath: "/auth/register",
        hasExplicitNext: true,
        nextPath: "/organizer/events",
        phoneVerified: false,
        platformRole: "MEMBER",
      }),
    ).toBe("/auth/register?step=phone&next=%2Forganizer%2Fevents");
  });

  it("電話番号が確認済みなら着地へ送る", () => {
    expect(
      resolveSessionDestination({
        audience: "participant",
        basePath: "/participant/login",
        hasExplicitNext: false,
        nextPath: "/participant",
        phoneVerified: true,
        platformRole: "MEMBER",
      }),
    ).toBe("/participant");
  });

  it("戻り先を指定されていなければ next を付けない", () => {
    expect(phoneStepHref("/participant/login", false, "/participant")).toBe(
      "/participant/login?step=phone",
    );
  });

  it("別の会員で入り直すのは switch=1 のときだけ", () => {
    expect(isSwitchingAccount("1")).toBe(true);
    expect(isSwitchingAccount("0")).toBe(false);
    expect(isSwitchingAccount(null)).toBe(false);
  });
});
