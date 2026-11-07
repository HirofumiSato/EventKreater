// @vitest-environment jsdom
//
// 「まとめて話す」の入口と確認画面の再発防止。
//
// 見るのは 5 つ。
//   1. 空欄が 3 つ以上なら「まとめて」を既定にし、話す順と例を出す
//   2. モックでは外部へ送らず、巡回する欄の入力例から行を組み立てる
//   3. 値は編集でき、チェックを外した行は取り込まない
//   4. 「すべて入力」は 1 回の onChange にまとめる（行ごとに呼ばない）
//   5. 残りの必須が 2 つ以上なら、まとめてのまま続けられる
//
// 入力欄はこの部品の外にあるので、値の受け渡しは `onChange` で見る。
// 待ちは疑似録音のものだけを進める（`userEvent` はタイマーを掴んで止まるため使わない）。

import { useState } from "react";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { VoiceInputDock } from "@/modules/events/components/VoiceInputDock";
import { VOICE_GUIDE_STORAGE_KEY } from "@/modules/events/lib/voice/guide";
import {
  createScheduleDraft,
  EMPTY_EVENT_FORM,
  type EventFormValues,
} from "@/modules/events/types";

/** 疑似録音と文字化の待ち（`MOCK_RECORDING_MS` / `MOCK_TRANSCRIBE_MS`）を越える長さ。 */
const PAST_RECORDING_MS = 1200;
const PAST_TRANSCRIBE_MS = 350;

/** モック可否の問い合わせだけを返す。POST が来たら試験で気づけるよう記録する。 */
function stubFetch() {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    if (init?.method === "POST") {
      // モックでは `/api/v1/voice/utterances` を呼ばない約束。呼ばれたら中身を見せる。
      return new Response("unexpected", { status: 500 });
    }
    // 郵便番号の補完は、住所が入ったときの流れを見るために成功させる。
    if (String(input).includes("/geo/postal-codes/")) {
      return Response.json({
        results: [{ prefecture: "東京都", city: "渋谷区", town: "神宮前" }],
      });
    }
    return Response.json({ mock: true });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function Harness({
  onChange,
  initial = EMPTY_EVENT_FORM,
}: {
  onChange: (next: EventFormValues) => void;
  initial?: EventFormValues;
}) {
  const [value, setValue] = useState<EventFormValues>(initial);
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

async function mount(
  onChange: (next: EventFormValues) => void,
  initial?: EventFormValues,
) {
  render(<Harness onChange={onChange} initial={initial} />);
  await act(async () => {});
}

async function press(name: string) {
  await act(async () => {
    screen.getByRole("button", { name }).click();
  });
}

async function chooseMode(name: string) {
  await act(async () => {
    screen.getByRole("radio", { name }).click();
  });
}

/**
 * マイクボタンから初回の案内を開き、話し方を選んで録音を始める。
 * 案内の 2 択はボタンで、名前の後ろに向く催しの札が付くため前方一致で選ぶ。
 */
async function startVoice(mode: "まとめて話す" | "1つずつ") {
  await press("音声入力を開始");
  await act(async () => {
    screen.getByRole("button", { name: new RegExp(`^${mode}`) }).click();
  });
}

/** 疑似録音と文字化の待ちを進め、確認のダイアログが出るところまで進める。 */
async function openBatchDialog() {
  // まとめては、開いた瞬間には録らない（読む時間を空ける）。押してから進める。
  await press("録音を始める");
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
  it("空欄が多いときは、話す順と例を添えて「まとめて」から始まる", async () => {
    stubFetch();
    const onChange = vi.fn();

    await mount(onChange);
    await startVoice("まとめて話す");

    // 空欄が 3 つ以上あるので、まとめてが既定になる。
    expect((screen.getByRole("radio", { name: "まとめて" }) as HTMLInputElement).checked).toBe(
      true,
    );
    expect(
      (screen.getByRole("radio", { name: "1つずつ" }) as HTMLInputElement).checked,
    ).toBe(false);
    // まとめては 1 つの欄の話ではないので、質問は進めない。何を話すかは、
    // 話す順に値を並べた読み上げ例で見せる。
    // 並びは「指示 → 欄の名前 → 読み上げ例 → 主ボタン」。
    expect(
      screen.getByText("録音ボタンを押して順に話してください。", {
        selector: ".voice-panel__lead",
      }),
    ).toBeTruthy();
    // 後半は必ず次の行から始める（パネルは 24rem までなので 1 行に詰められない）。
    expect(
      screen.getByText("全部読み上げ終えたら停止", {
        selector: ".voice-panel__lead-stop",
      }),
    ).toBeTruthy();
    // 話す順は欄の名前で並べる。郵便番号まで出す。順番の番号は名前に混ぜない。
    const list = screen.getByRole("list", { name: "話す順" });
    const cells = within(list).getAllByRole("listitem");
    expect(
      cells.map((cell) => cell.querySelector(".voice-cell__label")?.textContent),
    ).toEqual([
      "イベント名",
      "開催日",
      "開始時間",
      "終了時間",
      "料金プラン名",
      "料金（円）",
      "場所",
      "郵便番号",
    ]);
    // 順番は「1.」の形で示す。8 枚そろって 1 から数える。
    expect(
      cells.map((cell) => cell.querySelector(".voice-cell__number")?.textContent),
    ).toEqual(["1.", "2.", "3.", "4.", "5.", "6.", "7.", "8."]);
    // 順番は矢印でも示す。段の先頭の矢印は CSS で消すので、DOM には 8 枚とも置く。
    expect(
      cells.map((cell) => cell.querySelector(".voice-step__sep")?.textContent),
    ).toEqual(["→", "→", "→", "→", "→", "→", "→", "→"]);
    // 1 欄ずつの「いまの値」と戻る・スキップは、まとめてのときは出さない。
    // 押せない的を置かず、そもそも描かない。
    expect(screen.queryByText(/いまの値:/)).toBeNull();
    expect(screen.queryByRole("button", { name: "戻る" })).toBeNull();
    expect(screen.queryByRole("button", { name: "スキップ" })).toBeNull();
    expect(screen.queryByText("答えたら次へ")).toBeNull();
    // 何を話すかは、マスの名前だけでは分からない。値の形を 1 文で置き、
    // 何の例かを「読み上げ例：」で言う。
    expect(
      screen.getByText("読み上げ例：", {
        selector: ".voice-panel__say-label",
      }),
    ).toBeTruthy();
    expect(
      screen.getByText(
        "忘年会、12月5日、18時から20時、一般、3000円、渋谷ホール、1500001",
        { selector: ".voice-panel__say-text" },
      ),
    ).toBeTruthy();
    // まとめてでは、任意の欄は既定で外す（話す量を増やさない）。
    expect(
      (screen.getByLabelText("任意の項目も聞く") as HTMLInputElement).checked,
    ).toBe(false);
    // 読む量がいちばん多いので、開いた瞬間には録らない。押してから始める。
    // 丸い印だけでは何を押すか決まらないので、ボタンの下に名前を出す。
    expect(screen.queryByRole("button", { name: "録音を停止" })).toBeNull();
    expect(
      screen.getByText("録音を始める", { selector: ".voice-panel__talk" }),
    ).toBeTruthy();
    await press("録音を始める");
    expect(screen.getByRole("button", { name: "録音を停止" })).toBeTruthy();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("まとめて話すときは、後ろを黒透過の覆いで暗くする", async () => {
    stubFetch();

    await mount(vi.fn());
    await startVoice("まとめて話す");

    const scrim = document.querySelector<HTMLElement>(".voice-scrim");
    expect(scrim).toBeTruthy();
    // まとめては 1 つの欄を聞いているわけではないので、穴を空けない。
    expect(scrim?.style.clipPath).toBe("");
  });

  it("「1つずつ」を選ぶと、1 欄ずつの質問に戻る", async () => {
    stubFetch();
    const onChange = vi.fn();

    await mount(onChange);
    await startVoice("まとめて話す");
    await chooseMode("1つずつ");

    expect(screen.getByText("イベント名は？")).toBeTruthy();
    // まとめての話す順と 1 文の例は消え、1 欄ずつの例だけが残る。
    expect(screen.queryByRole("list", { name: "話す順" })).toBeNull();
    expect(screen.getByText("例: 忘年会")).toBeTruthy();
    // 1 つずつなら、空欄でよい欄まで聞く（まとめてと既定が違う）。
    expect(
      (screen.getByLabelText("任意の項目も聞く") as HTMLInputElement).checked,
    ).toBe(true);
    // まとめてに戻すと、また外れる。
    await chooseMode("まとめて");
    expect(
      (screen.getByLabelText("任意の項目も聞く") as HTMLInputElement).checked,
    ).toBe(false);
  });

  it("話している間に、読めたマスの数が増える", async () => {
    stubFetch();
    await mount(vi.fn());
    await startVoice("まとめて話す");

    const cells = () =>
      within(screen.getByRole("list", { name: "話す順" })).getAllByRole("listitem");
    const readCount = () =>
      cells().filter((cell) => cell.className.includes("is-read")).length;
    const say = () => document.querySelector(".voice-panel__say-text")?.textContent;

    // 押してから録り始める。まだ 1 枚も塗られていない。
    expect(readCount()).toBe(0);
    await press("録音を始める");
    await act(async () => {
      vi.advanceTimersByTime(PAST_RECORDING_MS);
    });
    expect(readCount()).toBe(0);
    // 何を話すかの 1 文は、録音中も文字化の途中も入れ替えない。
    expect(say()).toBe("忘年会、12月5日、18時から20時、一般、3000円、渋谷ホール、1500001");

    // 話すのをやめる（ダイアログが出る）前に、塗られるマスが増える。
    // 疑似の文字化は 350ms を 8 枚で割るので、1 枚目は 39ms、2 枚目は 78ms に来る。
    await act(async () => {
      vi.advanceTimersByTime(45);
    });
    const first = readCount();
    await act(async () => {
      vi.advanceTimersByTime(50);
    });
    const second = readCount();

    expect(first).toBeGreaterThan(0);
    expect(second).toBeGreaterThan(first);
    // 塗るだけで、値はまだ入れない。
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByText(/いまの値:/)).toBeNull();
    // 塗っても 1 文は入れ替えない（目で追う 1 行を動かさない）。
    expect(say()).toBe("忘年会、12月5日、18時から20時、一般、3000円、渋谷ホール、1500001");
  });

  it("モックでは外部へ送らず、欄ごとの行を並べる", async () => {
    const fetchMock = stubFetch();
    const onChange = vi.fn();

    await mount(onChange);
    await startVoice("まとめて話す");

    const dialog = await openBatchDialog();
    expect(within(dialog).getByRole("heading", { name: "まとめて入力します" })).toBeTruthy();
    // 先頭に、入る欄の数と、入らなかった欄を出す。
    expect(dialog.textContent).toContain("つの欄に入れます。");

    // 巡回する欄の入力例から、欄ごとの 1 行を作る。
    expect(within(dialog).getByLabelText("開催日")).toBeTruthy();
    expect(within(dialog).getByLabelText("会場名")).toBeTruthy();
    expect(within(dialog).getByLabelText("金額")).toBeTruthy();
    // 当たらなかったことは、話した言葉ではなく欄の名前で 1 行にまとめる
    // （同じ失敗を言葉と名前の 2 行で言わない）。
    expect(dialog.textContent).toContain("入らなかった欄: 町域、番地");
    expect(dialog.textContent).not.toContain("読み取れなかった部分");
    expect(dialog.textContent).not.toContain("神宮前");

    // マイクも外部も使わない。POST は 1 度も出ない。
    expect(fetchMock.mock.calls.every(([, init]) => init?.method !== "POST")).toBe(true);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("チェックを外した行は入れず、すべて入力を 1 回の更新にまとめる", async () => {
    stubFetch();
    const onChange = vi.fn();

    // 町域と番地は埋めておき、外したあとに残る必須が会場名だけになるようにする。
    await mount(onChange, {
      ...EMPTY_EVENT_FORM,
      town: "神宮前",
      addressLine: "1-2-3",
    });
    await startVoice("まとめて話す");
    // まとめてでは任意の欄を既定で外す。定員まで聞く形にしてから録る。
    await act(async () => {
      fireEvent.click(screen.getByLabelText("任意の項目も聞く"));
    });
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

    // 残りの必須が 1 つ（会場名）なので、1 欄ずつに切り替えて録音を始める。
    expect(screen.getByText("残りの欄は1つずつ話します。")).toBeTruthy();
    expect(screen.getByText("会場は？")).toBeTruthy();
    expect(screen.getByRole("button", { name: "録音を停止" })).toBeTruthy();
  });

  it("残りの必須が 2 つ以上なら、まとめてのまま続けられる", async () => {
    stubFetch();
    const onChange = vi.fn();

    // 番地だけ埋めておく。ほかの空欄は行として並ぶ。
    await mount(onChange, { ...EMPTY_EVENT_FORM, addressLine: "1-2-3" });
    await startVoice("まとめて話す");
    const dialog = await openBatchDialog();

    // 開催日と会場名を外すと、必須の空欄が 2 つ残る。
    await act(async () => {
      fireEvent.click(within(dialog).getByLabelText("開催日を取り込む"));
      fireEvent.click(within(dialog).getByLabelText("会場名を取り込む"));
    });
    await pressInDialog("すべて入力");

    expect(onChange).toHaveBeenCalledTimes(1);
    // 録音は自動で始めず、話す準備ができてから押してもらう。
    expect(screen.getByText("あと2つ。続けて話せます。")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "録音を停止" })).toBeNull();
    expect(screen.getByRole("button", { name: "録音を始める" })).toBeTruthy();
  });

  it("編集した行は、編集後の文字で parse し直す", async () => {
    stubFetch();
    const onChange = vi.fn();

    await mount(onChange);
    await startVoice("まとめて話す");
    const dialog = await openBatchDialog();

    const date = within(dialog).getByLabelText("開催日");
    await act(async () => {
      fireEvent.change(date, { target: { value: "12月6日" } });
    });
    await pressInDialog("すべて入力");

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(lastValue(onChange).schedules[0].eventDate).toMatch(/-12-06$/);
  });

  it("初回ガイドは、まとめてと 1 つずつの 2 択を同じ装飾で並べる", async () => {
    localStorage.removeItem(VOICE_GUIDE_STORAGE_KEY);
    stubFetch();

    await mount(vi.fn());

    expect(screen.getByText("話し方を選ぶと、入力が始まります。")).toBeTruthy();
    // どの催しに向く話しかは、ボタンの右端の札で示す。
    const batch = screen.getByRole("button", { name: /まとめて話す/ });
    const single = screen.getByRole("button", { name: /1つずつ/ });
    expect(within(batch).getByText("シンプルなイベント向け")).toBeTruthy();
    expect(within(single).getByText("複数日程・料金男女別向け")).toBeTruthy();
    // 案内はマイクを押すたびに出るので、「次回から表示しない」のチェックは置かない。
    expect(screen.queryByText("次回から表示しない")).toBeNull();
    expect(screen.queryByRole("checkbox")).toBeNull();
    // 片方を既定として推す札は置かない。
    expect(screen.queryByText("おすすめ")).toBeNull();
    // 2 択は同じ装飾。片方だけが主操作に見えない。
    expect(batch.className).toBe(single.className);
    expect(batch.className).toContain("btn--block");
    // 吹き出しの外を押しても閉じるが、中の 2 択はそのまま押せる。
    await act(async () => {
      single.click();
    });
    expect(screen.getByText("イベント名は？")).toBeTruthy();
  });

  it("案内を閉じると自動表示は止まるが、マイクを押せばまた出る", async () => {
    localStorage.removeItem(VOICE_GUIDE_STORAGE_KEY);
    stubFetch();

    await mount(vi.fn());
    expect(screen.getByText("話し方を選ぶと、入力が始まります。")).toBeTruthy();

    // 黒い面を押して閉じる。チェックは置かないので、閉じたこと自体を覚える。
    const scrim = document.querySelector(".voice-guide");
    expect(scrim).toBeTruthy();
    await act(async () => {
      fireEvent.click(scrim as Element);
    });

    expect(screen.queryByText("話し方を選ぶと、入力が始まります。")).toBeNull();
    expect(localStorage.getItem(VOICE_GUIDE_STORAGE_KEY)).toBe("1");

    // 手で押したときは記憶を見ない。案内はまた開く。
    await press("音声入力を開始");
    expect(screen.getByText("話し方を選ぶと、入力が始まります。")).toBeTruthy();
  });

  it("日程が 2 件あっても、初回ガイドの札と装飾は変わらない", async () => {
    localStorage.removeItem(VOICE_GUIDE_STORAGE_KEY);
    stubFetch();

    await mount(vi.fn(), {
      ...EMPTY_EVENT_FORM,
      schedules: [
        createScheduleDraft({ key: "schedule-1" }),
        createScheduleDraft({ key: "schedule-2" }),
      ],
    });

    // 行が複数あっても、札と装飾は 2 択で同じまま。
    const batch = screen.getByRole("button", { name: /まとめて話す/ });
    const single = screen.getByRole("button", { name: /1つずつ/ });
    expect(within(batch).getByText("シンプルなイベント向け")).toBeTruthy();
    expect(within(single).getByText("複数日程・料金男女別向け")).toBeTruthy();
    expect(screen.queryByText("おすすめ")).toBeNull();
    expect(batch.className).toBe(single.className);

    await act(async () => {
      single.click();
    });
    expect(screen.getByText("イベント名は？")).toBeTruthy();
  });
});
