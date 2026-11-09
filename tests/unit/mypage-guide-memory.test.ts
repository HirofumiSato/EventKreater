// @vitest-environment jsdom
// 主催者マイページの操作ガイドの記憶。
//
// 初回だけ自動で出すための `localStorage`（`memory.ts`）と、画面をまたいで続ける
// `sessionStorage`（`session.ts`）の 2 つを確かめる。差し替え方はイベント作成ガイドの
// `tests/unit/event-guide-memory.test.ts` と同じで、ブラウザの読み書きだけを持つ偽物を置く。
//
// 保存先が無い・参照しただけで例外になる環境でも落とさないこと（Safari の
// プライベートモードなど）を、どちらの記憶でも固定する。

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  dismissMyPageGuide,
  isMyPageGuideDismissed,
  MYPAGE_GUIDE_STORAGE_KEY,
} from "@/modules/organizers/lib/tour/memory";
import {
  clearMyPageGuideSession,
  MYPAGE_GUIDE_SESSION_KEY,
  MYPAGE_GUIDE_SESSION_TTL_MS,
  readMyPageGuideSession,
  writeMyPageGuideSession,
} from "@/modules/organizers/lib/tour/session";

/** localStorage / sessionStorage の代わり。ブラウザと同じ読み書きだけを持つ。 */
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
  delete (globalThis as { sessionStorage?: Storage }).sessionStorage;
});

describe("初回だけ出す記憶", () => {
  it("まだ閉じていなければ、次に開いたときも出す", () => {
    vi.stubGlobal("localStorage", memoryStorage());

    expect(isMyPageGuideDismissed()).toBe(false);
  });

  it("閉じたことを覚えると、次からは自動で出さない", () => {
    const storage = memoryStorage();
    vi.stubGlobal("localStorage", storage);

    dismissMyPageGuide();

    expect(storage.getItem(MYPAGE_GUIDE_STORAGE_KEY)).toBe("1");
    expect(isMyPageGuideDismissed()).toBe(true);
  });

  it("キーは eventkreater.mypage-guide.dismissed で、ほかのガイドと別に持つ", () => {
    const storage = memoryStorage();
    vi.stubGlobal("localStorage", storage);

    dismissMyPageGuide();

    expect(MYPAGE_GUIDE_STORAGE_KEY).toBe("eventkreater.mypage-guide.dismissed");
    expect(MYPAGE_GUIDE_STORAGE_KEY).not.toBe("eventkreater.event-guide.dismissed");
    expect(MYPAGE_GUIDE_STORAGE_KEY).not.toBe("eventkreater.voice-guide.dismissed");
    // 片方を閉じても、もう片方の記憶は動かない。
    expect(storage.getItem("eventkreater.event-guide.dismissed")).toBeNull();
    expect(storage.getItem("eventkreater.voice-guide.dismissed")).toBeNull();
  });

  it("localStorage が無い環境でも落ちず、毎回出す", () => {
    vi.stubGlobal("localStorage", undefined);

    expect(isMyPageGuideDismissed()).toBe(false);
    expect(() => dismissMyPageGuide()).not.toThrow();
  });

  it("localStorage を読むだけで例外になる環境でも落ちず、毎回出す", () => {
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      get() {
        throw new Error("localStorage is blocked");
      },
    });

    expect(isMyPageGuideDismissed()).toBe(false);
    expect(() => dismissMyPageGuide()).not.toThrow();
  });

  it("getItem が例外を投げても落ちず、毎回出す", () => {
    vi.stubGlobal("localStorage", {
      ...memoryStorage(),
      getItem() {
        throw new Error("read blocked");
      },
      setItem() {
        throw new Error("write blocked");
      },
    });

    expect(isMyPageGuideDismissed()).toBe(false);
    expect(() => dismissMyPageGuide()).not.toThrow();
  });
});

describe("画面をまたぐ続き", () => {
  it("進んだ枚を書き、そのまま読み戻せる", () => {
    const storage = memoryStorage();
    vi.stubGlobal("sessionStorage", storage);

    writeMyPageGuideSession("inviteCoHost");

    const session = readMyPageGuideSession();
    expect(session?.step).toBe("inviteCoHost");
    expect(typeof session?.at).toBe("number");
    expect(storage.getItem(MYPAGE_GUIDE_SESSION_KEY)).not.toBeNull();
  });

  it("キーは eventkreater.mypage-guide.session（タブを閉じるまでの一時的な記憶）", () => {
    const storage = memoryStorage();
    vi.stubGlobal("sessionStorage", storage);

    writeMyPageGuideSession("referral");

    expect(MYPAGE_GUIDE_SESSION_KEY).toBe("eventkreater.mypage-guide.session");
    expect(storage.getItem(MYPAGE_GUIDE_SESSION_KEY)).not.toBeNull();
    expect(readMyPageGuideSession()?.step).toBe("referral");
  });

  it("10 分を過ぎた続きは捨てて null を返す", () => {
    const storage = memoryStorage();
    vi.stubGlobal("sessionStorage", storage);
    storage.setItem(
      MYPAGE_GUIDE_SESSION_KEY,
      JSON.stringify({ step: "organizerEvents", at: Date.now() - MYPAGE_GUIDE_SESSION_TTL_MS - 1 }),
    );

    expect(readMyPageGuideSession()).toBeNull();
    expect(storage.getItem(MYPAGE_GUIDE_SESSION_KEY)).toBeNull();
  });

  it("ちょうど 10 分はまだ続きとして読む", () => {
    const storage = memoryStorage();
    vi.stubGlobal("sessionStorage", storage);
    storage.setItem(
      MYPAGE_GUIDE_SESSION_KEY,
      JSON.stringify({ step: "organizerEvents", at: Date.now() - MYPAGE_GUIDE_SESSION_TTL_MS }),
    );

    expect(readMyPageGuideSession()?.step).toBe("organizerEvents");
  });

  it("壊れた JSON は捨てて null を返し、キーも消す", () => {
    const storage = memoryStorage();
    vi.stubGlobal("sessionStorage", storage);
    storage.setItem(MYPAGE_GUIDE_SESSION_KEY, "{");

    expect(readMyPageGuideSession()).toBeNull();
    expect(storage.getItem(MYPAGE_GUIDE_SESSION_KEY)).toBeNull();
  });

  it("知らない step は捨てて null を返す（枚を減らしたあとの古い続き）", () => {
    const storage = memoryStorage();
    vi.stubGlobal("sessionStorage", storage);
    storage.setItem(
      MYPAGE_GUIDE_SESSION_KEY,
      JSON.stringify({ step: "unknown", at: Date.now() }),
    );

    expect(readMyPageGuideSession()).toBeNull();
    expect(storage.getItem(MYPAGE_GUIDE_SESSION_KEY)).toBeNull();
  });

  it("at が数値でない続きも捨てる", () => {
    const storage = memoryStorage();
    vi.stubGlobal("sessionStorage", storage);
    storage.setItem(
      MYPAGE_GUIDE_SESSION_KEY,
      JSON.stringify({ step: "referral", at: "now" }),
    );

    expect(readMyPageGuideSession()).toBeNull();
  });

  it("sessionStorage が無い環境でも落ちない", () => {
    vi.stubGlobal("sessionStorage", undefined);

    expect(readMyPageGuideSession()).toBeNull();
    expect(() => writeMyPageGuideSession("referral")).not.toThrow();
    expect(() => clearMyPageGuideSession()).not.toThrow();
  });

  it("sessionStorage を読むだけで例外になる環境でも落ちない", () => {
    Object.defineProperty(globalThis, "sessionStorage", {
      configurable: true,
      get() {
        throw new Error("sessionStorage is blocked");
      },
    });

    expect(readMyPageGuideSession()).toBeNull();
    expect(() => writeMyPageGuideSession("referral")).not.toThrow();
    expect(() => clearMyPageGuideSession()).not.toThrow();
  });

  it("clearMyPageGuideSession で続きを消す", () => {
    const storage = memoryStorage();
    vi.stubGlobal("sessionStorage", storage);
    writeMyPageGuideSession("final");
    expect(readMyPageGuideSession()).not.toBeNull();

    clearMyPageGuideSession();

    expect(readMyPageGuideSession()).toBeNull();
    expect(storage.getItem(MYPAGE_GUIDE_SESSION_KEY)).toBeNull();
  });

  it("続きを書くたびに at を新しくする（読んでいるだけで失効しない）", () => {
    const storage = memoryStorage();
    vi.stubGlobal("sessionStorage", storage);
    storage.setItem(
      MYPAGE_GUIDE_SESSION_KEY,
      JSON.stringify({ step: "referral", at: Date.now() - MYPAGE_GUIDE_SESSION_TTL_MS + 1000 }),
    );

    writeMyPageGuideSession("notifications");

    const session = readMyPageGuideSession();
    expect(session?.step).toBe("notifications");
    expect(Date.now() - (session?.at ?? 0)).toBeLessThan(1000);
  });
});
