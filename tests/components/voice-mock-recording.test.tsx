// @vitest-environment jsdom
//
// ローカル専用の近道（`VOICE_TRANSCRIBE_MOCK=1`）の再発防止。
//
// 見るのは 5 つ。
//   1. モックなら、マイクを掴まずに開いた瞬間から「録音中」になる
//   2. 少し待つと確認のモーダルが出る（実の経路と同じく、勝手に値を入れない）
//   3. 「確定」で値が入り、次の欄の録音へ自動で進む
//   4. 録音中でも戻る・スキップが押せ、移った欄で録音を始め直す
//   5. モックでなければ、これまでどおり録音を試みる（マイクが無ければ案内を出す）
//
// 入力欄はこの部品の外にあるので、値の受け渡しは `onChange` で見る。
// 待ちは疑似録音のものだけを進める（`userEvent` はタイマーを掴んで止まるため使わない）。

import { useState } from "react";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { VoiceInputDock } from "@/modules/events/components/VoiceInputDock";
import { VOICE_GUIDE_STORAGE_KEY } from "@/modules/events/lib/voice/guide";
import {
  createPricePlanDraft,
  createScheduleDraft,
  EMPTY_EVENT_FORM,
  type EventFormValues,
} from "@/modules/events/types";

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

function Harness({
  onChange,
  initial,
  focusId,
}: {
  onChange: (next: EventFormValues) => void;
  initial?: EventFormValues;
  focusId?: string;
}) {
  const [value, setValue] = useState<EventFormValues>(initial ?? EMPTY_EVENT_FORM);
  return (
    <>
      {/* 音声モードの開始位置を決める入力欄。部品の外にある本物の欄の代わり。 */}
      {focusId ? <input id={focusId} aria-label="音声の開始位置" /> : null}
      <VoiceInputDock
        value={value}
        onChange={(next) => {
          setValue(next);
          onChange(next);
        }}
        api={{ openStep: () => {}, announce: () => {} }}
      />
    </>
  );
}

/** 部品を描き、開いたときの 1 度だけの問い合わせを済ませる。 */
async function mount(
  onChange: (next: EventFormValues) => void,
  options: { initial?: EventFormValues; focusId?: string } = {},
) {
  render(<Harness onChange={onChange} initial={options.initial} focusId={options.focusId} />);
  await act(async () => {});
  // 開始位置は focusin で控えられる。音声モードを開く前に当てておく。
  if (options.focusId) {
    await act(async () => {
      document.getElementById(options.focusId ?? "")?.focus();
    });
  }
}

/** 押して、押した結果の描き直しを待つ。 */
async function press(name: string) {
  await act(async () => {
    screen.getByRole("button", { name }).click();
  });
}

/**
 * 音声モードを 1 欄ずつで開く。マイクボタンは案内（吹き出し）を開くだけなので、
 * 案内の「1つずつ」を選んで録音を始める。
 */
async function startSingle() {
  await press("音声入力を開始");
  await act(async () => {
    screen.getByRole("button", { name: /^1つずつ/ }).click();
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
    await startSingle();

    const talk = screen.getByRole("button", { name: "録音を停止" });
    expect(talk.getAttribute("data-state")).toBe("stop");
    expect(screen.getByText("録音中")).toBeTruthy();
  });

  it("少し待つと確認のモーダルが出て、確定すると次の欄の録音に移る", async () => {
    stubMockAnswer(true);
    const onChange = vi.fn();

    await mount(onChange);
    await startSingle();
    await passMockWait();

    // 値はまだ入っていない。まず何を入れるかを見せる（実の経路と同じ）。
    expect(onChange).not.toHaveBeenCalled();
    // 題は固定の 1 文。値は本文の入力へ置く（題にフォーム要素を置かない）。
    expect(screen.getByRole("heading", { name: "入力内容の確認" })).toBeTruthy();
    expect((screen.getByRole("textbox") as HTMLInputElement).value).toBe("忘年会");

    await press("確定");

    // 1 欄目（イベント名）は入力例の「忘年会」で埋まる。
    expect(lastValue(onChange).title).toBe("忘年会");
    // 次の欄（開催日）の録音が始まっている。ここが止まると自動遷移が途切れる。
    expect(screen.getByRole("button", { name: "録音を停止" })).toBeTruthy();
  });

  it("「再録音」なら値を入れずに、同じ欄を録り直す", async () => {
    stubMockAnswer(true);
    const onChange = vi.fn();

    await mount(onChange);
    await startSingle();
    await passMockWait();
    await press("再録音");

    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "録音を停止" })).toBeTruthy();
  });

  it("話すボタンを押すと、待たずにその場で文字化へ移る", async () => {
    stubMockAnswer(true);
    const onChange = vi.fn();

    await mount(onChange);
    await startSingle();
    await press("録音を停止");
    await act(async () => {
      vi.advanceTimersByTime(PAST_TRANSCRIBE_MS);
    });

    // 押したときも確認は挟む。
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole("heading", { name: "入力内容の確認" })).toBeTruthy();
  });
});

describe("録音中の戻る・スキップ", () => {
  it("録音中でもスキップが押せて、次の欄の録音に移る", async () => {
    stubMockAnswer(true);
    const onChange = vi.fn();

    await mount(onChange);
    await startSingle();
    expect(screen.getByText("イベント名は？")).toBeTruthy();

    // 録音を止める主ボタンとは別に、飛ばす操作も録音中から押せる。
    const skip = screen.getByRole("button", { name: "スキップ" }) as HTMLButtonElement;
    expect(skip.disabled).toBe(false);
    await press("スキップ");

    // 飛ばした欄の録音は捨て、次の欄（開催日）の録音が始まる。値はまだ入らない。
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByText("開催日は？")).toBeTruthy();
    expect(screen.getByRole("button", { name: "録音を停止" })).toBeTruthy();
  });

  it("スキップの下に、同じ見た目の「スキップ」を出す", async () => {
    stubMockAnswer(true);

    await mount(() => {});
    await startSingle();

    const label = screen.getByText("スキップ");
    expect(label.tagName).toBe("P");
    expect(label.className).toContain("voice-panel__talk");
    // アイコンだけのボタンの意味は、aria-label と下の文字の両方で伝える。
    expect(screen.getByRole("button", { name: "スキップ" })).toBeTruthy();
  });

  it("2 欄目でも戻るが押せて、前の欄の録音に戻る", async () => {
    stubMockAnswer(true);
    const onChange = vi.fn();

    await mount(onChange);
    await startSingle();
    // 1 欄目を飛ばして、2 欄目（開催日）の録音にする。
    await press("スキップ");
    expect(screen.getByText("開催日は？")).toBeTruthy();

    const back = screen.getByRole("button", { name: "戻る" }) as HTMLButtonElement;
    expect(back.disabled).toBe(false);
    await press("戻る");

    // 録音中でも戻れ、戻った欄（イベント名）ですぐ録音が始まる。
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByText("イベント名は？")).toBeTruthy();
    expect(screen.getByRole("button", { name: "録音を停止" })).toBeTruthy();
  });
});

describe("モックでないとき", () => {
  it("これまでどおり録音を試み、マイクが無ければ案内を出す", async () => {
    stubMockAnswer(false);
    vi.stubGlobal("MediaRecorder", undefined);

    await mount(() => {});
    // メッセージは話し方に依らない。まとめてのまま開き、マイクを押して案内を見る
    // （まとめては開いただけでは録らない）。
    await press("音声入力を開始");
    await act(async () => {
      screen.getByRole("button", { name: /^まとめて話す/ }).click();
    });
    await press("録音を始める");

    expect(
      screen.getByText("このブラウザは録音に対応していません。手で入力してください。"),
    ).toBeTruthy();
  });

  it("開始の途中で二度押ししても、マイクを掴むのは 1 回だけ", async () => {
    stubMockAnswer(false);
    const getUserMedia = stubPendingMicrophone();

    await mount(() => {});
    await startSingle();
    // マイクの許可待ちのあいだ（まだ「録音中」になっていない）にもう一度押す。
    await press("話す");

    // 2 本目を掴むと、先に掴んだストリームが止まらないまま残る。
    expect(getUserMedia).toHaveBeenCalledTimes(1);
  });
});

describe("入力内容の確認を直す", () => {
  it("編集した文字で確定する", async () => {
    stubMockAnswer(true);
    const onChange = vi.fn();

    await mount(onChange);
    await startSingle();
    await passMockWait();

    const input = screen.getByRole("textbox") as HTMLInputElement;
    await act(async () => {
      fireEvent.change(input, { target: { value: "新年会" } });
    });
    expect(input.value).toBe("新年会");
    await press("確定");

    // 確定は編集後の文字で parse する。
    expect(lastValue(onChange).title).toBe("新年会");
  });

  it("空にすると確定できない", async () => {
    stubMockAnswer(true);
    const onChange = vi.fn();

    await mount(onChange);
    await startSingle();
    await passMockWait();

    await act(async () => {
      fireEvent.change(screen.getByRole("textbox"), { target: { value: "   " } });
    });
    const ok = screen.getByRole("button", { name: "確定" }) as HTMLButtonElement;
    expect(ok.disabled).toBe(true);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("長い欄は複数行で直せる", async () => {
    stubMockAnswer(true);
    const onChange = vi.fn();

    // 会場名から始める（会場名は自由文なので必ず確認を挟む）。
    await mount(onChange, { focusId: "event-venue-name" });
    await startSingle();
    await passMockWait();

    const box = within(screen.getByRole("dialog")).getByRole("textbox") as HTMLTextAreaElement;
    expect(box.tagName).toBe("TEXTAREA");
    expect(box.value).toBe("渋谷ホール");
    await press("確定");
    expect(lastValue(onChange).venueName).toBe("渋谷ホール");
  });
});

describe("自動確定する欄", () => {
  it("確認を出さずに入り、3 秒だけ知らせを出して次の欄へ進む", async () => {
    stubMockAnswer(true);
    const onChange = vi.fn();

    // 開催日から始める（開催日は形が閉じているので自動確定）。
    await mount(onChange, { focusId: "schedule-date-schedule-initial" });
    await startSingle();
    await passMockWait();

    // 確認は出さず、その場で値が入る。
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(lastValue(onChange).schedules[0].eventDate).toMatch(/-12-05$/);
    expect(screen.getByText("開催日を「12月5日」で入力しました")).toBeTruthy();
    // 自動確定でも既存の流れ（次の欄へ進んで録音）はそのまま通る。
    expect(screen.getByText("何時に始まる？")).toBeTruthy();
    expect(screen.getByRole("button", { name: "録音を停止" })).toBeTruthy();

    // 知らせは 3 秒で消える。
    await act(async () => {
      vi.advanceTimersByTime(3000);
    });
    expect(screen.queryByText("開催日を「12月5日」で入力しました")).toBeNull();
  });
});

/**
 * 必須の欄だけを埋めたフォーム。任意の欄（雨天時の方針・定員・申し込み期限）は空のまま。
 * 「任意の項目も聞く」を外したときの巡回が、必須を埋めた時点で尽きる場面を作る。
 */
function formWithRequiredFields(overrides: Partial<EventFormValues> = {}): EventFormValues {
  return {
    ...EMPTY_EVENT_FORM,
    title: "忘年会",
    schedules: [
      createScheduleDraft({
        key: "schedule-initial",
        eventDate: "2026-12-05",
        startTime: "18:00",
        endTime: "20:00",
      }),
    ],
    pricePlans: [createPricePlanDraft({ key: "plan-initial", name: "一般", amount: "3000" })],
    venueName: "渋谷ホール",
    postalCode: "1500001",
    prefecture: "東京都",
    city: "渋谷区",
    town: "神南",
    addressLine: "1-2-3",
    building: "3階",
    ...overrides,
  };
}

describe("入力できる欄が尽きたとき", () => {
  it("必須がそろっていれば「必須項目の入力完了！」と、テーマ・チラシの案内を出す", async () => {
    stubMockAnswer(true);
    const onChange = vi.fn();

    // 最後に残った必須（建物名）から始め、聞き取った時点で巡回が尽きる。
    await mount(onChange, {
      initial: formWithRequiredFields({ building: "" }),
      focusId: "event-building",
    });
    await startSingle();
    // 任意の欄を聞くと、そろっていても次を尋ね続ける。必須だけで終わる形にする。
    await act(async () => {
      fireEvent.click(screen.getByLabelText("任意の項目も聞く"));
    });
    await passMockWait();
    await press("確定");

    expect(lastValue(onChange).building).toContain("3階");
    // 「入力完了」ではなく、必須がそろったことと次にすることが伝わる。
    expect(screen.getByText("必須項目の入力完了！")).toBeTruthy();
    expect(screen.getByText("テーマを選び、チラシを作ると仕上がります。")).toBeTruthy();

    // 案内を読み終えられる長さ（5 秒）だけ見せてから、音声モードを抜ける。
    await act(async () => {
      vi.advanceTimersByTime(5000);
    });
    expect(screen.queryByText("必須項目の入力完了！")).toBeNull();
  });

  it("スキップで必須を飛ばしていれば、完了と言わずに残りを手で入れるよう案内する", async () => {
    stubMockAnswer(true);
    const onChange = vi.fn();

    await mount(onChange, {
      initial: formWithRequiredFields({ title: "" }),
      focusId: "event-title",
    });
    await startSingle();
    await act(async () => {
      fireEvent.click(screen.getByLabelText("任意の項目も聞く"));
    });

    // 空のまま飛ばすと巡回が尽きる。必須（イベント名）は空のままなので、完了とは言わない。
    await press("スキップ");

    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByText("必須の入力が残っています")).toBeTruthy();
    expect(screen.getByText("ステップを開いて、残りを入れてください。")).toBeTruthy();
    expect(screen.queryByText("必須項目の入力完了！")).toBeNull();
  });
});
