// @vitest-environment jsdom
//
// 未ログインのチラシ作成の再発防止（`FlyerGeneratePanel` の `requireAuth`）。
//
// 未ログインの作成画面では、チラシの生成も会員登録・ログインの先にしかできない。
// ここではボタンが認証へ送るだけで、ウィザードを開かないことを見る。
//   1. プレビューが無ければ「新規登録/ログインしてチラシ作成」を出し、押すと `onRequireAuth` を呼ぶ
//   2. プレビューがあるときの「作り直す」も、同じく認証へ送る
//   3. 回数枠を使い切っていても押せる（未ログインは回数ではなく認証で判断する）
//   4. 既定（編集画面など会員の画面）は今までどおり、検証してからウィザードを開く
//
// 入力を退避してから認証へ送るのは呼び出し元（作成画面の `goAuth`）の仕事。
// ここでは `onRequireAuth` が何回呼ばれたかだけを見る。

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EMPTY_EVENT_FORM } from "@/modules/events/types";
import { FlyerGeneratePanel } from "@/modules/flyers/components/FlyerGeneratePanel";
import type { FlyerQuota } from "@/modules/flyers/types";

/** 未ログインの 1 枠。押しても止まらないことを見るために、使い切った状態も作る。 */
const GUEST_QUOTA: FlyerQuota = { limit: 1, used: 0, remaining: 1, anonymous: true };

const GUEST_LABEL = "新規登録/ログインしてチラシ作成";
const REVALIDATE_MESSAGE = "先に開催日の開始・終了時刻を入れてください。";

const fetchMock = vi.fn();

function quotaResponse(quota: FlyerQuota): Response {
  return { ok: true, json: async () => ({ quota }) } as unknown as Response;
}

function renderPanel(options: {
  requireAuth?: boolean;
  onRequireAuth?: () => void;
  previewUrl?: string | null;
  disabled?: boolean;
}) {
  return render(
    <FlyerGeneratePanel
      value={EMPTY_EVENT_FORM}
      disabled={options.disabled}
      previewUrl={options.previewUrl ?? null}
      draftScope="new"
      requireAuth={options.requireAuth}
      onRequireAuth={options.onRequireAuth}
      onGenerated={() => {}}
      onClear={() => {}}
    />,
  );
}

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(quotaResponse(GUEST_QUOTA));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("未ログインのチラシ作成", () => {
  it("「新規登録/ログインしてチラシ作成」を出し、押すと認証の導線を呼ぶ", async () => {
    const user = userEvent.setup();
    const onRequireAuth = vi.fn();
    renderPanel({ requireAuth: true, onRequireAuth });

    await user.click(screen.getByRole("button", { name: GUEST_LABEL }));

    expect(onRequireAuth).toHaveBeenCalledTimes(1);
    // ウィザードは開かず、未入力の検証もしない（認証のあとで直せる）。
    expect(screen.queryByText(REVALIDATE_MESSAGE)).toBeNull();
  });

  it("プレビューがあるときの「作り直す」も、認証へ送る", async () => {
    const user = userEvent.setup();
    const onRequireAuth = vi.fn();
    renderPanel({ requireAuth: true, onRequireAuth, previewUrl: "/samples/flyer-gohan.jpg" });

    await user.click(screen.getByRole("button", { name: "作り直す" }));

    expect(onRequireAuth).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: GUEST_LABEL })).toBeNull();
  });

  it("回数枠を使い切っていても、認証へ送るボタンは押せる", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(
      quotaResponse({ limit: 1, used: 1, remaining: 0, anonymous: true }),
    );
    const onRequireAuth = vi.fn();
    renderPanel({ requireAuth: true, onRequireAuth });

    // 残り 0 の案内が出るまで待ってから、無効になっていないことを見る。
    await screen.findByText(/未ログインで作れるチラシは 1 回までです。/);
    const button = screen.getByRole("button", { name: GUEST_LABEL }) as HTMLButtonElement;
    expect(button.disabled).toBe(false);

    await user.click(button);

    expect(onRequireAuth).toHaveBeenCalledTimes(1);
  });
});

describe("会員の画面（既定）", () => {
  it("「チラシを新規作成」のまま、未入力ならウィザードを開かずに理由を出す", async () => {
    const user = userEvent.setup();
    const onRequireAuth = vi.fn();
    renderPanel({ onRequireAuth });

    expect(screen.queryByRole("button", { name: GUEST_LABEL })).toBeNull();
    await user.click(screen.getByRole("button", { name: "チラシを新規作成" }));

    expect(screen.getByText(REVALIDATE_MESSAGE)).toBeTruthy();
    expect(onRequireAuth).not.toHaveBeenCalled();
  });
});
