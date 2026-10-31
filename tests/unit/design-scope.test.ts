import { describe, expect, it } from "vitest";
import { decoClassName, designScope } from "@/lib/design-scope";

describe("装飾スコープの判定", () => {
  it("管理コンソールは装飾しない", () => {
    expect(designScope("/console")).toBe("none");
    expect(designScope("/console/users")).toBe("none");
    expect(designScope("/console/pricing")).toBe("none");
    expect(decoClassName("none")).toBe("");
  });

  it("導入の画面は影だけのスコープになる", () => {
    expect(designScope("/")).toBe("pop");
    expect(designScope("/service")).toBe("pop");
    expect(designScope("/terms")).toBe("pop");
    expect(decoClassName("pop")).toBe("deco deco--tape deco--tape-shadow");
  });

  it("告知ページと参加者の画面は導入のスコープになる", () => {
    expect(designScope("/events/abc")).toBe("pop");
    expect(designScope("/events/abc/receipt")).toBe("pop");
    expect(designScope("/organizers/u1")).toBe("pop");
    expect(designScope("/organizers/u1/events")).toBe("pop");
    expect(designScope("/participant")).toBe("pop");
    expect(designScope("/participant/calendar")).toBe("pop");
    expect(designScope("/participant/history")).toBe("pop");
  });

  it("入る前の手続きは導入のスコープになる", () => {
    expect(designScope("/auth/register")).toBe("pop");
    expect(designScope("/auth/verify")).toBe("pop");
    expect(designScope("/participant/login")).toBe("pop");
    expect(designScope("/invitations/code1")).toBe("pop");
    expect(designScope("/account")).toBe("pop");
    expect(designScope("/account/email/verify")).toBe("pop");
  });

  it("主催者の管理画面は静かめのスコープになる", () => {
    expect(designScope("/mypage")).toBe("quiet");
    expect(designScope("/notifications")).toBe("quiet");
    expect(designScope("/organizer/events")).toBe("quiet");
    expect(designScope("/organizer/events/drafts")).toBe("quiet");
    expect(designScope("/organizer/events/ev1/edit")).toBe("quiet");
    expect(designScope("/organizer/events/ev1/participants")).toBe("quiet");
    expect(designScope("/organizer/calendar")).toBe("quiet");
    expect(designScope("/organizer/revenue")).toBe("quiet");
    expect(designScope("/organizer/profile")).toBe("quiet");
    expect(designScope("/organizer/register-required")).toBe("quiet");
    expect(decoClassName("quiet")).toBe("deco deco--tape deco--tape-quiet");
  });

  it("新規イベント作成だけは、主催者の下でも導入のスコープになる", () => {
    expect(designScope("/organizer/events/new")).toBe("pop");
  });

  it("区切りを跨いだ前方一致をしない", () => {
    expect(designScope("/organizerx")).toBe("pop");
    expect(designScope("/consolelike")).toBe("pop");
    expect(designScope("/mypagex")).toBe("pop");
    expect(designScope("/organizer/events/newer")).toBe("quiet");
  });

  it("パスが空でも導入に倒す", () => {
    expect(designScope("")).toBe("pop");
  });
});
