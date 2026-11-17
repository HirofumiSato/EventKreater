import { describe, expect, it } from "vitest";
import { alreadyRegisteredUrl, verificationUrl } from "@/modules/auth/lib/verification-links";

// 確認メールの URL の再発防止。
// 登録を始めた画面（`next`）を、確認 → 電話番号の確認まで引き回す。
// 許可していない戻り先は載せない（メールのリンクから別の画面へ飛ばさない）。

function parsed(value: string): URL {
  return new URL(value);
}

describe("確認メールの URL", () => {
  it("token と戻り先を載せる", () => {
    const url = parsed(verificationUrl("tok123", "ORGANIZER", "/organizer/events/new?ref=abc"));

    expect(url.pathname).toBe("/auth/verify");
    expect(url.searchParams.get("token")).toBe("tok123");
    expect(url.searchParams.get("next")).toBe("/organizer/events/new?ref=abc");
    // 主催者は既定なので audience を付けない。
    expect(url.searchParams.has("audience")).toBe(false);
  });

  it("参加者の入口は audience も載せる", () => {
    const url = parsed(verificationUrl("tok123", "PARTICIPANT", "/participant/events/abc"));

    expect(url.searchParams.get("audience")).toBe("participant");
    expect(url.searchParams.get("next")).toBe("/participant/events/abc");
  });

  it("戻り先が無ければ next を付けない", () => {
    expect(parsed(verificationUrl("tok123", "ORGANIZER")).searchParams.has("next")).toBe(false);
    expect(parsed(verificationUrl("tok123", "ORGANIZER", null)).searchParams.has("next")).toBe(false);
  });

  it("許可していない戻り先は付けない", () => {
    expect(parsed(verificationUrl("tok123", "ORGANIZER", "/console")).searchParams.has("next")).toBe(false);
    expect(
      parsed(verificationUrl("tok123", "ORGANIZER", "//evil.example.com")).searchParams.has("next"),
    ).toBe(false);
  });
});

describe("既登録の案内", () => {
  it("ログインの入口と戻り先を持つ", () => {
    const url = parsed(alreadyRegisteredUrl("/organizer/events/new"));

    expect(url.pathname).toBe("/auth/register");
    expect(url.searchParams.get("mode")).toBe("login");
    expect(url.searchParams.get("next")).toBe("/organizer/events/new");
  });

  it("戻り先が無い・不正なときは mode だけにする", () => {
    expect(parsed(alreadyRegisteredUrl()).searchParams.has("next")).toBe(false);
    expect(parsed(alreadyRegisteredUrl("/console")).searchParams.has("next")).toBe(false);
    expect(parsed(alreadyRegisteredUrl("/console")).searchParams.get("mode")).toBe("login");
  });
});
