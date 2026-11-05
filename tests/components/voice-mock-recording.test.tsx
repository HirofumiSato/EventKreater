// @vitest-environment jsdom
//
// ローカル専用の近道（`VOICE_TRANSCRIBE_MOCK=1`）の再発防止。
//
// 見るのは 4 つ。
//   1. モックなら、マイクを掴まずに開いた瞬間から「録音中」になる
//   2. 少し待つと確認のモーダルが出る（実の経路と同じく、勝手に値を入れない）
//   3. 「入力を確定する」で値が入り、次の欄の録音へ自動で進む
//   4. モックでなければ、これまでどおり録音を試みる（マイクが無ければ案内を出す）
//
// 入力欄はこの部品の外にあるので、値の受け渡しは `onChange` で見る。
// 待ちは疑似録音のものだけを進める（`userEvent` はタイマーを掴んで止まるため使わない）。

import { useState } from "react";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { VoiceInputDock } from "@/modules/events/components/VoiceInputDock";
import { VOICE_GUIDE_STORAGE_KEY } from "@/modules/events/lib/voice/guide";
import { EMPTY_EVENT_FORM, type EventFormValues } from "@/modules/events/types";

/** 疑似録音と文字化の待ち（`MOCK_RECORDING_MS` / `MOCK_TRANSCRIBE_MS`）を越える長さ。 */
const PAST_RECORDING_MS = 1200;
const PAST_TRANSCRIBE_MS = 350;

/** サーバーの「モックかどうか」の返事だけを差し替える。 */
function stubMockAnswer(mock: boolean) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Response.json({ mock })),
  );
}

function Harness({ onChange }: { onChange: (next: EventFormValues) => void }) {
  const [value, setValue] = useState<EventFormValues>(EMPTY_EVENT_FORM);
  return (
    <VoiceInputDock
      value={value}
      onChange={(next) => {
        setValue(next);
        onChange(next);
      }}
      api={{ openStep: () => {}, announce: () => {} }}
    />
  );
}

/** 部品を描き、開いたときの 1 度だけの問い合わせを済ませる。 */
async function mount(onChange: (next: EventFormValues) => void) {
  render(<Harness onChange={onChange} />);
  await act(async () => {});
}

/** 押して、押した結果の描き直しを待つ。 */
async function press(name: string) {
  await act(async () => {
    screen.getByRole("button", { name }).click();
  });
}

/** 疑似録音と文字化の待ちを進める。 */
async function passMockWait() {
  await act(async () => {
    vi.advanceTimersByTime(PAST_RECORDING_MS);
  });
  await act(async () => {
    vi.advanceTimersByTime(PAST_TRANSCRIBE_MS);
  });
}

/** 直近に渡した値。 */
function lastValue(onChange: { mock: { calls: unknown[][] } }): EventFormValues {
  return onChange.mock.calls.at(-1)?.[0] as EventFormValues;
}

/**
 * 返事を返さないままの偽のマイク。許可待ちのあいだに押されたときの重複を見るために使う。
 * `getUserMedia` が返らないので、録音は始まらず「話す」のまま止まる。
 */
function stubPendingMicrophone() {
  const getUserMedia = vi.fn(() => new Promise<MediaStream>(() => {}));
  Object.defineProperty(navigator, "mediaDevices", {
    value: { getUserMedia },
    configurable: true,
  });
  // 形だけ。`getUserMedia` が返らないので、この試験では作られない。
  vi.stubGlobal("MediaRecorder", class {});
  return getUserMedia;
}

beforeEach(() => {
  vi.useFakeTimers();
  // 初回の案内は見たいものではないので、閉じた状態から始める。
  localStorage.setItem(VOICE_GUIDE_STORAGE_KEY, "1");
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(navigator, "mediaDevices");
  localStorage.clear();
});

describe("モックの疑似録音", () => {
  it("マイクを使わずに、開いた瞬間から録音中になる", async () => {
    stubMockAnswer(true);
    // 録音の API は無い（マイクの無い PC と同じ）。
    vi.stubGlobal("MediaRecorder", undefined);

    await mount(() => {});
    await press("音声入力を開始");

    const talk = screen.getByRole("button", { name: "録音を停止" });
    expect(talk.getAttribute("data-state")).toBe("stop");
    expect(screen.getByText("録音中")).toBeTruthy();
  });

  it("少し待つと確認のモーダルが出て、確定すると次の欄の録音に移る", async () => {
    stubMockAnswer(true);
    const onChange = vi.fn();

    await mount(onChange);
    await press("音声入力を開始");
    await passMockWait();

    // 値はまだ入っていない。まず何を入れるかを見せる（実の経路と同じ）。
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole("heading", { name: "入力を確定しますか" })).toBeTruthy();
    expect(screen.getByText("「忘年会」")).toBeTruthy();

    await press("入力を確定する");

    // 1 欄目（イベント名）は入力例の「忘年会」で埋まる。
    expect(lastValue(onChange).title).toBe("忘年会");
    // 次の欄（開催日）の録音が始まっている。ここが止まると自動遷移が途切れる。
    expect(screen.getByRole("button", { name: "録音を停止" })).toBeTruthy();
  });

  it("「再録音する」なら値を入れずに、同じ欄を録り直す", async () => {
    stubMockAnswer(true);
    const onChange = vi.fn();

    await mount(onChange);
    await press("音声入力を開始");
    await passMockWait();
    await press("再録音する");

    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "録音を停止" })).toBeTruthy();
  });

  it("話すボタンを押すと、待たずにその場で文字化へ移る", async () => {
    stubMockAnswer(true);
    const onChange = vi.fn();

    await mount(onChange);
    await press("音声入力を開始");
    await press("録音を停止");
    await act(async () => {
      vi.advanceTimersByTime(PAST_TRANSCRIBE_MS);
    });

    // 押したときも確認は挟む。
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole("heading", { name: "入力を確定しますか" })).toBeTruthy();
  });
});

describe("モックでないとき", () => {
  it("これまでどおり録音を試み、マイクが無ければ案内を出す", async () => {
    stubMockAnswer(false);
    vi.stubGlobal("MediaRecorder", undefined);

    await mount(() => {});
    await press("音声入力を開始");

    expect(
      screen.getByText("このブラウザは録音に対応していません。手で入力してください。"),
    ).toBeTruthy();
  });

  it("開始の途中で二度押ししても、マイクを掴むのは 1 回だけ", async () => {
    stubMockAnswer(false);
    const getUserMedia = stubPendingMicrophone();

    await mount(() => {});
    await press("音声入力を開始");
    // マイクの許可待ちのあいだ（まだ「録音中」になっていない）にもう一度押す。
    await press("話す");

    // 2 本目を掴むと、先に掴んだストリームが止まらないまま残る。
    expect(getUserMedia).toHaveBeenCalledTimes(1);
  });
});
