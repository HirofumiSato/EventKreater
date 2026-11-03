// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import {
  savePasswordCredential,
  type PasswordCredentialContainer,
} from "@/modules/auth/lib/password-credential";

/** `PasswordCredential` の代わり。渡された値だけを覚えておく。 */
class FakePasswordCredential {
  constructor(readonly init: { id: string; password: string; name?: string }) {}
}

const input = { email: "person@example.invalid", password: "Test-passw0rd-2026", name: "山田 太郎" };

/** 保存まで進めるコンテナ。`store` だけをテストごとに差し替える。 */
function containerWith(store: ReturnType<typeof vi.fn>): PasswordCredentialContainer {
  return {
    isSecureContext: true,
    PasswordCredential: FakePasswordCredential,
    credentials: { store },
  };
}

describe("パスワードの保存", () => {
  it("非セキュアコンテキストでは保存せず false を返す", async () => {
    const store = vi.fn().mockResolvedValue(undefined);
    const container: PasswordCredentialContainer = {
      ...containerWith(store),
      isSecureContext: false,
    };

    await expect(savePasswordCredential(input, container)).resolves.toBe(false);
    expect(store).not.toHaveBeenCalled();
  });

  it("PasswordCredential が無ければ保存しない", async () => {
    const store = vi.fn().mockResolvedValue(undefined);
    const container: PasswordCredentialContainer = {
      ...containerWith(store),
      PasswordCredential: null,
    };

    await expect(savePasswordCredential(input, container)).resolves.toBe(false);
    expect(store).not.toHaveBeenCalled();
  });

  it("credentials.store が失敗しても例外を投げず false を返す", async () => {
    const store = vi.fn().mockRejectedValue(new Error("NotAllowedError"));

    await expect(savePasswordCredential(input, containerWith(store))).resolves.toBe(false);
    expect(store).toHaveBeenCalledTimes(1);
  });

  it("保存できたら、メールアドレス・パスワード・名前を渡して 1 回だけ頼む", async () => {
    const store = vi.fn().mockResolvedValue(undefined);

    await expect(savePasswordCredential(input, containerWith(store))).resolves.toBe(true);

    expect(store).toHaveBeenCalledTimes(1);
    const stored = store.mock.calls[0]?.[0];
    expect(stored).toBeInstanceOf(FakePasswordCredential);
    expect((stored as FakePasswordCredential).init).toEqual({
      id: input.email,
      password: input.password,
      name: input.name,
    });
  });
});
