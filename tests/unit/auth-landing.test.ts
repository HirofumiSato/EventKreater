import { describe, expect, it } from "vitest";
import {
  isSwitchingAccount,
  phoneStepHref,
  resolveAuthLanding,
  resolveSessionDestination,
} from "@/modules/auth/lib/auth-landing";

describe("ログイン済みセッションの着地", () => {
  it("戻り先の指定があれば、そのパスへ返す", () => {
    expect(
      resolveAuthLanding({
        audience: "organizer",
        hasExplicitNext: true,
        nextPath: "/organizer/events",
      }),
    ).toBe("/organizer/events");
  });

  // 管理者を管理コンソールへ送ると、公開の入口を押しただけで管理コンソールの
  // 在り処が分かってしまう。役割では分岐しない（FE-ADM-01 / FE-AUTH-06）。
  it("主催者の入口は、管理者でもマイページへ返す", () => {
    expect(
      resolveAuthLanding({
        audience: "organizer",
        hasExplicitNext: false,
        nextPath: "/mypage",
      }),
    ).toBe("/mypage");
  });

  it("参加者の入口は、いつでも参加者ホームへ返す", () => {
    expect(
      resolveAuthLanding({
        audience: "participant",
        hasExplicitNext: false,
        nextPath: "/participant",
      }),
    ).toBe("/participant");
  });

  it("着地が管理コンソールを指すことはない", () => {
    for (const audience of ["organizer", "participant"] as const) {
      for (const hasExplicitNext of [true, false]) {
        const destination = resolveAuthLanding({
          audience,
          hasExplicitNext,
          nextPath: hasExplicitNext ? "/organizer/events" : `/${audience === "organizer" ? "mypage" : "participant"}`,
        });
        expect(destination.startsWith("/console")).toBe(false);
      }
    }
  });

  it("電話番号が未確認なら、ログインは済んでいるので確認画面だけを出す", () => {
    expect(
      resolveSessionDestination({
        audience: "organizer",
        basePath: "/auth/register",
        hasExplicitNext: true,
        nextPath: "/organizer/events",
        phoneVerified: false,
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
