import { afterEach, describe, expect, it, vi } from "vitest";
import {
  dismissVoiceGuide,
  isVoiceGuideDismissed,
  VOICE_GUIDE_STORAGE_KEY,
} from "@/modules/events/lib/voice/guide";

/** localStorage の代わり。ブラウザと同じ読み書きだけを持つ。 */
function memoryStorage(): Storage {
  const items = new Map<string, string>();
  return {
    get length() {
      return items.size;
    },
    clear: () => items.clear(),
    getItem: (key: string) => items.get(key) ?? null,
    key: (index: number) => Array.from(items.keys())[index] ?? null,
    removeItem: (key: string) => {
      items.delete(key);
    },
    setItem: (key: string, value: string) => {
      items.set(key, value);
    },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  // 例外を投げる getter を差した試験の後始末。定義そのものが残ると次の試験へ漏れる。
  delete (globalThis as { localStorage?: Storage }).localStorage;
});

describe("初回ガイドの記憶", () => {
  it("まだ閉じていなければ、次に開いたときも出す", () => {
    vi.stubGlobal("localStorage", memoryStorage());

    expect(isVoiceGuideDismissed()).toBe(false);
  });

  it("「次回から表示しない」を選ぶと、次からは出さない", () => {
    const storage = memoryStorage();
    vi.stubGlobal("localStorage", storage);

    dismissVoiceGuide(true);

    expect(storage.getItem(VOICE_GUIDE_STORAGE_KEY)).toBe("1");
    expect(isVoiceGuideDismissed()).toBe(true);
  });

  it("チェックを入れずに閉じたときは、記憶を残さない", () => {
    const storage = memoryStorage();
    storage.setItem(VOICE_GUIDE_STORAGE_KEY, "1");
    vi.stubGlobal("localStorage", storage);

    dismissVoiceGuide(false);

    expect(storage.getItem(VOICE_GUIDE_STORAGE_KEY)).toBeNull();
    expect(isVoiceGuideDismissed()).toBe(false);
  });

  it("localStorage が無い環境でも落ちず、毎回出す", () => {
    vi.stubGlobal("localStorage", undefined);

    expect(isVoiceGuideDismissed()).toBe(false);
    expect(() => dismissVoiceGuide(true)).not.toThrow();
  });

  it("localStorage を読むだけで例外になる環境でも落ちず、毎回出す", () => {
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      get() {
        throw new Error("localStorage is blocked");
      },
    });

    expect(isVoiceGuideDismissed()).toBe(false);
    expect(() => dismissVoiceGuide(true)).not.toThrow();
  });
});
