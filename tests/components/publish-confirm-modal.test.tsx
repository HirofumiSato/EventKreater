// @vitest-environment jsdom
//
// 公開前の確認の層（`PublishConfirmModal`）と、公開後の層（`PublishUsedModal`）の再発防止。
//
// 確認の層で見るのは 4 つ。
//   1. 種類ごとに題と使うものが変わる（無料チケットだけ「無料チケットを使って公開しますか？」）
//   2. 本文に、使うものと公開後の説明を出す
//   3. 注記に「残りチケット数：N枚」を出す（使った前後は出さない）
//   4. 送信中は 2 つのボタンを押せなくし、主操作を「公開中…」にする
//
// 押したときの動きは呼び出し元の仕事。ここでは `onConfirm` / `onClose` が
// 何回呼ばれたかだけを見る。

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PublishConfirmModal } from "@/modules/billing/components/PublishConfirmModal";
import { PublishUsedModal } from "@/modules/billing/components/PublishUsedModal";
import type { PublishConfirmation } from "@/modules/billing/lib/publish-confirm";

const EVENT_TITLE = "秋の飯フェス";
const LAST_SENTENCE = "公開すると、告知URLが有効になり出欠を受け付けます。";

function renderModal(confirmation: PublishConfirmation, busy = false) {
  const onClose = vi.fn();
  const onConfirm = vi.fn();
  const utils = render(
    <PublishConfirmModal
      eventTitle={EVENT_TITLE}
      confirmation={confirmation}
      busy={busy}
      onClose={onClose}
      onConfirm={onConfirm}
    />,
  );
  return { ...utils, onClose, onConfirm };
}

function renderUsedModal(remaining = 1) {
  const onClose = vi.fn();
  const utils = render(
    <PublishUsedModal eventTitle={EVENT_TITLE} remaining={remaining} onClose={onClose} />,
  );
  return { ...utils, onClose };
}

afterEach(() => {
  cleanup();
});

describe("題と本文", () => {
  it("チケットは「チケットを使って公開しますか？」で、残りを枚で出す", () => {
    renderModal({ kind: "FREE_TICKET", remaining: 3, remainingAfter: 2 });
    expect(screen.getByRole("heading", { name: "チケットを使って公開しますか？" })).toBeTruthy();
    expect(
      screen.getByText(`${EVENT_TITLE}。チケットを1枚使います。${LAST_SENTENCE}`),
    ).toBeTruthy();
    expect(screen.getByText("残りチケット数：3枚")).toBeTruthy();
  });

  it("単発チケットは題も本文も単発チケットにする", () => {
    renderModal({ kind: "PAID_CREDIT", remaining: 1, remainingAfter: 0 });
    expect(
      screen.getByRole("heading", { name: "単発チケットを使って公開しますか？" }),
    ).toBeTruthy();
    expect(
      screen.getByText(`${EVENT_TITLE}。単発チケットを1枚使います。${LAST_SENTENCE}`),
    ).toBeTruthy();
    expect(screen.getByText("残りチケット数：1枚")).toBeTruthy();
  });

  it("無料チケットは題も本文も無料チケットにし、単位を枚にそろえる", () => {
    renderModal({ kind: "FREE_TRIAL", remaining: 2, remainingAfter: 1 });
    expect(
      screen.getByRole("heading", { name: "無料チケットを使って公開しますか？" }),
    ).toBeTruthy();
    expect(
      screen.getByText(`${EVENT_TITLE}。無料チケットを1枚使います。${LAST_SENTENCE}`),
    ).toBeTruthy();
    expect(screen.getByText("残りチケット数：2枚")).toBeTruthy();
  });

  it("使ったあとの残りは本文に出さない", () => {
    renderModal({ kind: "FREE_TICKET", remaining: 3, remainingAfter: 2 });
    expect(screen.queryByText(/→/)).toBeNull();
  });
});

describe("操作", () => {
  it("「公開する」を押すと、onConfirm を 1 回だけ呼ぶ", async () => {
    const user = userEvent.setup();
    const { onClose, onConfirm } = renderModal({
      kind: "FREE_TRIAL",
      remaining: 2,
      remainingAfter: 1,
    });

    await user.click(screen.getByRole("button", { name: "公開する" }));

    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("「やめる」を押すと、onClose を呼ぶ", async () => {
    const user = userEvent.setup();
    const { onClose, onConfirm } = renderModal({
      kind: "FREE_TICKET",
      remaining: 3,
      remainingAfter: 2,
    });

    await user.click(screen.getByRole("button", { name: "やめる" }));

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });
});

describe("送信中", () => {
  it("主操作を「公開中…」にして、2 つのボタンを押せなくする", () => {
    renderModal({ kind: "FREE_TRIAL", remaining: 2, remainingAfter: 1 }, true);

    const primary = screen.getByRole("button", { name: "公開中…" }) as HTMLButtonElement;
    const cancel = screen.getByRole("button", { name: "やめる" }) as HTMLButtonElement;

    expect(primary.disabled).toBe(true);
    expect(cancel.disabled).toBe(true);
    expect(screen.queryByRole("button", { name: "公開する" })).toBeNull();
  });
});

describe("公開後の層", () => {
  it("題・本文・使ったあとの残り枚数を出す", () => {
    renderUsedModal(1);
    expect(screen.getByRole("heading", { name: "チケットを使いました" })).toBeTruthy();
    expect(screen.getByText(`「${EVENT_TITLE}」を公開しました。`)).toBeTruthy();
    expect(screen.getByText("残りチケット数：1枚")).toBeTruthy();
  });

  it("「告知ページを見る」を押すと、onClose を 1 回だけ呼ぶ", async () => {
    const user = userEvent.setup();
    const { onClose } = renderUsedModal(0);

    await user.click(screen.getByRole("button", { name: "告知ページを見る" }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
