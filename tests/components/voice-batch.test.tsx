// @vitest-environment jsdom
//
// 「まとめて話す」の確認画面の再発防止。
//
// 見るのは 4 つ。
//   1. モックでは外部へ送らず、巡回する欄の入力例から行を組み立てる
//   2. 値は編集でき、チェックを外した行は取り込まない
//   3. 「すべて入力」は 1 回の onChange にまとめる（行ごとに呼ばない）
//   4. 編集された行は、編集後の文字で parse し直す
//
// 入力欄はこの部品の外にあるので、値の受け渡しは `onChange` で見る。
// 待ちは疑似録音のものだけを進める（`userEvent` はタイマーを掴んで止まるため使わない）。

import { useState } from "react";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { VoiceInputDock } from "@/modules/events/components/VoiceInputDock";
import { VOICE_GUIDE_STORAGE_KEY } from "@/modules/events/lib/voice/guide";
import { EMPTY_EVENT_FORM, type EventFormValues } from "@/modules/events/types";

/** 疑似録音と文字化の待ち（`MOCK_RECORDING_MS` / `MOCK_TRANSCRIBE_MS`）を越える長さ。 */
const PAST_RECORDING_MS = 1200;
const PAST_TRANSCRIBE_MS = 350;

/** モック可否の問い合わせだけを返す。POST が来たら試験で気づけるよう記録する。 */
function stubFetch() {
  const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
    if (init?.method === "POST") {
      // モックでは `/api/v1/voice/utterances` を呼ばない約束。呼ばれたら中身を見せる。
      return new Response("unexpected", { status: 500 });
    }
    return Response.json({ mock: true });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
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

async function mount(onChange: (next: EventFormValues) => void) {
  render(<Harness onChange={onChange} />);
  await act(async () => {});
}

async function press(name: string) {
  await act(async () => {
    screen.getByRole("button", { name }).click();
  });
}

async function toggle(name: string) {
  await act(async () => {
    screen.getByRole("checkbox", { name }).click();
  });
}

/** 疑似録音と文字化の待ちを進め、確認のダイアログが出るところまで進める。 */
async function openBatchDialog() {
  await act(async () => {
    vi.advanceTimersByTime(PAST_RECORDING_MS);
  });
  await act(async () => {
    vi.advanceTimersByTime(PAST_TRANSCRIBE_MS);
  });
  return screen.getByRole("dialog");
}

async function pressInDialog(name: string) {
  await act(async () => {
    within(screen.getByRole("dialog")).getByText(name).click();
  });
  // 反映のあと（郵便番号の補完の待ち）まで流す。
  await act(async () => {});
}

/** 直近に渡した値。 */
function lastValue(onChange: { mock: { calls: unknown[][] } }): EventFormValues {
  return onChange.mock.calls.at(-1)?.[0] as EventFormValues;
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
  localStorage.clear();
});

describe("まとめて話す", () => {
  it("モックでは外部へ送らず、欄ごとの行を並べる", async () => {
    const fetchMock = stubFetch();
    const onChange = vi.fn();

    await mount(onChange);
    await press("音声入力を開始");
    await toggle("まとめて話す");

    // 質問と例は 1 回の録音向けに替わる。
    expect(screen.getByText("順番に話してください")).toBeTruthy();
    expect(
      screen.getByText("例: 12月5日、18時から20時、渋谷ホール、3000円、30人"),
    ).toBeTruthy();

    const dialog = await openBatchDialog();
    expect(within(dialog).getByRole("heading", { name: "まとめて入力します" })).toBeTruthy();

    // 巡回する欄の入力例から、欄ごとの 1 行を作る。
    expect(within(dialog).getByLabelText("開催日")).toBeTruthy();
    expect(within(dialog).getByLabelText("会場名")).toBeTruthy();
    expect(within(dialog).getByLabelText("金額")).toBeTruthy();
    // どの欄にも当たらなかった節も 1 行で残す。
    expect(dialog.textContent).toContain("読み取れなかった部分:");

    // マイクも外部も使わない。POST は 1 度も出ない。
    expect(fetchMock.mock.calls.every(([, init]) => init?.method !== "POST")).toBe(true);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("チェックを外した行は入れず、すべて入力を 1 回の更新にまとめる", async () => {
    stubFetch();
    const onChange = vi.fn();

    await mount(onChange);
    await press("音声入力を開始");
    await toggle("まとめて話す");
    const dialog = await openBatchDialog();

    // 会場名だけ取り込まない。
    await act(async () => {
      fireEvent.click(within(dialog).getByLabelText("会場名を取り込む"));
    });
    await pressInDialog("すべて入力");

    // 行ごとに onChange を呼ばず、1 回にまとめる。
    expect(onChange).toHaveBeenCalledTimes(1);
    const value = lastValue(onChange);
    expect(value.title).toBe("忘年会");
    expect(value.schedules[0].eventDate).toMatch(/-12-05$/);
    expect(value.schedules[0].startTime).toBe("18:00");
    expect(value.schedules[0].endTime).toBe("20:00");
    expect(value.pricePlans[0].amount).toBe("3000");
    expect(value.capacity).toBe(30);
    // 外した行は入らない。
    expect(value.venueName).toBe("");

    // 反映したら、最初の未入力欄（会場名）へ移って録音を始める。
    expect(screen.getByText("会場は？")).toBeTruthy();
    expect(screen.getByRole("button", { name: "録音を停止" })).toBeTruthy();
  });

  it("編集した行は、編集後の文字で parse し直す", async () => {
    stubFetch();
    const onChange = vi.fn();

    await mount(onChange);
    await press("音声入力を開始");
    await toggle("まとめて話す");
    const dialog = await openBatchDialog();

    const date = within(dialog).getByLabelText("開催日");
    await act(async () => {
      fireEvent.change(date, { target: { value: "12月6日" } });
    });
    await pressInDialog("すべて入力");

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(lastValue(onChange).schedules[0].eventDate).toMatch(/-12-06$/);
  });
});
