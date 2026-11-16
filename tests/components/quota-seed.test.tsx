// @vitest-environment jsdom
//
// クォータの初期値（`QuotaSeed`）の再発防止。
//
// サーバーコンポーネントは、描画に必要な残数を最初の HTML に載せる。画面側はその値を
// そのまま使い、ハイドレーション後にもう一度取りに行かない。ここで見るのは 4 つ。
//   1. `ready` は渡された値で始まり、`fetch` を呼ばない
//   2. `signed-out` は `fetch` を呼ばず、帯を出さない（`loading` もしない）
//   3. 初期値が無い画面は、今までどおりマウント後に取りに行く
//   4. `unknown`（サーバーで読めなかった）も、今までどおり取りに行って値で埋める
//
// 購入・付与のあとの `refreshQuota()` は初期値に関係なく飛ぶ（この試験では触らない）。

import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useEventQuota } from "@/modules/billing/hooks/useEventQuota";
import type { UserQuota } from "@/modules/events/types";

/** 未加入の会員。帯が出る最小の形だけを持つ。 */
function quota(): UserQuota {
  return {
    freeEventCount: 0,
    freeLimit: 2,
    remainingFree: 2,
    paidCredits: 0,
    subscriptionStatus: "NONE",
    subscriptionPlan: "NONE",
    currentPeriodEnd: null,
    canCreate: true,
    planType: "FREE_TRIAL",
    phoneVerified: true,
  };
}

function quotaResponse(value: UserQuota): Response {
  return { ok: true, json: async () => value } as unknown as Response;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("useEventQuota の初期値", () => {
  it("ready を渡すと、その値で始まり fetch を呼ばない", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const seeded = quota();

    const { result } = renderHook(() => useEventQuota({ status: "ready", quota: seeded }));

    expect(result.current.quota).toBe(seeded);
    expect(result.current.isLoading).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("signed-out を渡すと、fetch を呼ばずに帯を出さない", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useEventQuota({ status: "signed-out" }));

    expect(result.current.quota).toBeNull();
    // 読み込み中の場所取りも出さない（待っている相手がいない）。
    expect(result.current.isLoading).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("初期値が無い画面は、今までどおりマウント後に取りに行く", async () => {
    const fetchMock = vi.fn(async () => quotaResponse(quota()));
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useEventQuota());

    expect(result.current.isLoading).toBe(true);
    await waitFor(() => expect(result.current.quota).not.toBeNull());
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.current.isLoading).toBe(false);
  });

  it("unknown を渡すと、取りに行って値で埋める", async () => {
    const fetchMock = vi.fn(async () => quotaResponse(quota()));
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useEventQuota({ status: "unknown" }));

    await waitFor(() => expect(result.current.quota).not.toBeNull());
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.current.isLoading).toBe(false);
  });
});
