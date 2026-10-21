import { describe, expect, it } from "vitest";
import { resolveInitialAuthMode } from "@/modules/auth/lib/auth-mode";

describe("resolveInitialAuthMode", () => {
  it("mode=register は next があっても登録で始める", () => {
    expect(resolveInitialAuthMode("register", true)).toBe("register");
  });

  it("mode=login は next が無くてもログインで始める", () => {
    expect(resolveInitialAuthMode("login", false)).toBe("login");
  });

  it("mode が無ければ next の有無で決める", () => {
    expect(resolveInitialAuthMode(null, true)).toBe("login");
    expect(resolveInitialAuthMode(null, false)).toBe("register");
  });

  it("知らない mode は無視する", () => {
    expect(resolveInitialAuthMode("signup", true)).toBe("login");
    expect(resolveInitialAuthMode("", false)).toBe("register");
  });
});
