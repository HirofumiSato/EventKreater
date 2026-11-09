// @vitest-environment jsdom
//
// 概要のリッチテキスト（`EventSummaryEditor`）の再発防止。
//
// ここで見るのは 4 つ。
//   1. 表示文字数のカウンタが「x / 1000」で出る（タグは数えない）
//   2. 本文を打つと、その innerHTML を `onChange` で返す
//   3. 1000 文字を超えると `aria-invalid` と超過の 1 文を出す
//   4. 1000 文字以内なら `aria-invalid` を出さない
//
// ツールバーの書式は `document.execCommand` に頼る。jsdom は実装していないため、
// 押したときの書式はここでは見ない（押しても本文を壊さないことだけを確かめる）。

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EventSummaryEditor } from "@/modules/events/components/EventSummaryEditor";

afterEach(() => {
  cleanup();
});

function renderEditor(value: string, options: { disabled?: boolean } = {}) {
  const onChange = vi.fn();
  render(
    <EventSummaryEditor
      id="event-summary"
      value={value}
      onChange={onChange}
      disabled={options.disabled}
    />,
  );
  return { onChange, body: screen.getByRole("textbox", { name: "イベント概要" }) };
}

describe("概要の入力欄", () => {
  it("空のときは 0 / 1000 を出し、超過の印は付けない", () => {
    const { body } = renderEditor("");

    expect(screen.getByText("0 / 1000")).toBeTruthy();
    expect(body.getAttribute("aria-invalid")).toBeNull();
  });

  it("入力済みの値を本文に描き、タグを除いた文字数を出す", () => {
    const { body } = renderEditor("<b>夕暮れ</b>の音楽");

    expect(body.innerHTML).toBe("<b>夕暮れ</b>の音楽");
    // 「夕暮れの音楽」の 6 文字。タグは数えない。
    expect(screen.getByText("6 / 1000")).toBeTruthy();
    expect(body.getAttribute("aria-invalid")).toBeNull();
  });

  it("本文を打つと、その innerHTML を onChange で返す", () => {
    const { onChange, body } = renderEditor("");

    body.innerHTML = "<b>河原で炊きます</b><br>鍋を囲みます";
    fireEvent.input(body);

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith("<b>河原で炊きます</b><br>鍋を囲みます");
  });

  it("1000 文字ちょうどは超過にしない", () => {
    const { body } = renderEditor("あ".repeat(1000));

    expect(screen.getByText("1000 / 1000")).toBeTruthy();
    expect(body.getAttribute("aria-invalid")).toBeNull();
    expect(screen.queryByText("1000文字を超えています。")).toBeNull();
  });

  it("1001 文字は aria-invalid を立て、超過の 1 文を出す", () => {
    const { body } = renderEditor("あ".repeat(1001));

    expect(screen.getByText("1001 / 1000")).toBeTruthy();
    expect(body.getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByText("1000文字を超えています。")).toBeTruthy();
  });

  it("disabled のときは本文を編集できない", () => {
    const { body } = renderEditor("<b>夕暮れ</b>の音楽", { disabled: true });

    expect(body.getAttribute("contenteditable")).toBe("false");
    expect(body.getAttribute("aria-disabled")).toBe("true");
  });
});
