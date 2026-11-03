import { describe, expect, it } from "vitest";
import { analyticsEnabled, analyticsPagePath, trackEvent, trackPageView } from "@/lib/analytics";

describe("計測してよいかの判定", () => {
  it("測定 ID が空なら本番でも無効", () => {
    expect(analyticsEnabled("", "production")).toBe(false);
    expect(analyticsEnabled("   ", "production")).toBe(false);
  });

  it("本番以外は測定 ID があっても無効", () => {
    expect(analyticsEnabled("G-XXXXXXXXXX", "development")).toBe(false);
    expect(analyticsEnabled("G-XXXXXXXXXX", "test")).toBe(false);
    expect(analyticsEnabled("G-XXXXXXXXXX", "")).toBe(false);
  });

  it("本番かつ測定 ID があれば有効", () => {
    expect(analyticsEnabled("G-XXXXXXXXXX", "production")).toBe(true);
    expect(analyticsEnabled("  G-XXXXXXXXXX  ", "production")).toBe(true);
  });
});

describe("送るパスの正規化", () => {
  it("管理コンソールは送らない", () => {
    expect(analyticsPagePath("/console")).toBeNull();
    expect(analyticsPagePath("/console/users")).toBeNull();
  });

  it("管理コンソールに似た別パスは除外しない", () => {
    expect(analyticsPagePath("/consolex")).toBe("/consolex");
  });

  it("UUID の節は :id に置き換える", () => {
    expect(analyticsPagePath("/events/3f2b8c1e-9a4d-4e7b-8c2f-1d5e6a7b8c9d")).toBe("/events/:id");
    expect(analyticsPagePath("/organizers/3f2b8c1e-9a4d-4e7b-8c2f-1d5e6a7b8c9d/events")).toBe(
      "/organizers/:id/events",
    );
  });

  it("招待コードの節は :code に置き換える", () => {
    expect(analyticsPagePath("/invitations/abc123")).toBe("/invitations/:code");
  });

  it("クエリ付きの入力でもパスだけを返す", () => {
    expect(analyticsPagePath("/events?draft=1")).toBe("/events");
    expect(analyticsPagePath("/participant/history?page=2#top")).toBe("/participant/history");
  });

  it("末尾スラッシュは落とし、先頭スラッシュは残す", () => {
    expect(analyticsPagePath("/")).toBe("/");
    expect(analyticsPagePath("/terms/")).toBe("/terms");
    expect(analyticsPagePath("/events/")).toBe("/events");
  });

  it("パスでない値でも例外を投げない", () => {
    expect(analyticsPagePath("")).toBeNull();
    expect(analyticsPagePath("events")).toBeNull();
  });
});

describe("送信のヘルパー", () => {
  interface WindowStub {
    dataLayer?: unknown[];
    gtag?: (...args: unknown[]) => void;
  }

  /** 本番かつ測定 ID ありの状態で、window を差し替えて本文を実行する。終わったら必ず戻す。 */
  function withEnabledWindow(windowStub: WindowStub, run: (stub: WindowStub) => void): void {
    const globalWithWindow = globalThis as { window?: WindowStub };
    // NODE_ENV は型の上で読み取り専用。テストの間だけ書き換える。
    const env = process.env as Record<string, string | undefined>;
    const originalWindow = globalWithWindow.window;
    const originalId = env.NEXT_PUBLIC_GA_MEASUREMENT_ID;
    const originalNodeEnv = env.NODE_ENV;
    globalWithWindow.window = windowStub;
    env.NEXT_PUBLIC_GA_MEASUREMENT_ID = "G-XXXXXXXXXX";
    env.NODE_ENV = "production";
    try {
      run(windowStub);
    } finally {
      if (originalWindow === undefined) {
        delete globalWithWindow.window;
      } else {
        globalWithWindow.window = originalWindow;
      }
      if (originalId === undefined) {
        delete env.NEXT_PUBLIC_GA_MEASUREMENT_ID;
      } else {
        env.NEXT_PUBLIC_GA_MEASUREMENT_ID = originalId;
      }
      if (originalNodeEnv === undefined) {
        delete env.NODE_ENV;
      } else {
        env.NODE_ENV = originalNodeEnv;
      }
    }
  }

  it("window が無い環境でも例外を投げない", () => {
    expect(() => trackEvent("login", { audience: "participant" })).not.toThrow();
    expect(() => trackPageView("/events")).not.toThrow();
  });

  it("dataLayer が無い環境でも trackEvent は例外を投げない", () => {
    const globalWithWindow = globalThis as { window?: unknown };
    const original = globalWithWindow.window;
    globalWithWindow.window = {};
    try {
      expect(() => trackEvent("login", { audience: "participant" })).not.toThrow();
      expect(() => trackPageView("/events")).not.toThrow();
    } finally {
      if (original === undefined) {
        delete globalWithWindow.window;
      } else {
        globalWithWindow.window = original;
      }
    }
  });

  it("有効なときは dataLayer を作り、ページビューを 1 件積む", () => {
    withEnabledWindow({}, (stub) => {
      trackPageView("/events/3f2b8c1e-9a4d-4e7b-8c2f-1d5e6a7b8c9d?draft=1", "催し");
      expect(stub.dataLayer).toEqual([
        {
          event: "page_view",
          page_path: "/events/:id",
          page_title: "催し",
          page_location: "/events/:id",
        },
      ]);
    });
  });

  it("gtag があればコマンド形でページビューを送り、dataLayer へは積まない", () => {
    const calls: unknown[][] = [];
    withEnabledWindow(
      {
        gtag: (...args: unknown[]) => {
          calls.push(args);
        },
      },
      (stub) => {
        trackPageView("/events/3f2b8c1e-9a4d-4e7b-8c2f-1d5e6a7b8c9d?draft=1", "催し");
        expect(calls).toEqual([
          [
            "event",
            "page_view",
            { page_path: "/events/:id", page_title: "催し", page_location: "/events/:id" },
          ],
        ]);
        expect(stub.dataLayer).toBeUndefined();
      },
    );
  });

  it("gtag があれば任意のイベントもコマンド形で送る", () => {
    const calls: unknown[][] = [];
    withEnabledWindow(
      {
        gtag: (...args: unknown[]) => {
          calls.push(args);
        },
      },
      (stub) => {
        trackEvent("login", { audience: "participant" });
        expect(calls).toEqual([["event", "login", { audience: "participant" }]]);
        expect(stub.dataLayer).toBeUndefined();
      },
    );
  });
});
