// @vitest-environment jsdom
//
// 「自由に話す」の入口・録音中の文字起こし・確認画面の再発防止。
//
// 見るのは 7 つ。
//   1. 空欄が 3 つ以上なら「自由に話す」を既定にし、1 文の例と、押した瞬間に出る文字の枠を出す
//   2. 録音中に聞き取れた文字が、区間ごとに順へ増える（消えない）
//   3. モックでは外部へ送らず、欄ごとの行を確認に並べる
//   4. 値は編集でき、チェックを外した行は取り込まない
//   5. 「すべて入力」は 1 回の onChange にまとめる（行ごとに呼ばない）
//   6. 残りの必須が 1 つ以下なら、1 欄ずつへ切り替える
//   7. 自由に話すでは、いま空欄の欄を「話す順」のマスに並べる（1 つずつでは出さない）
//
// 入力欄はこの部品の外にあるので、値の受け渡しは `onChange` で見る。
// 待ちは疑似録音のものだけを進める（`userEvent` はタイマーを掴んで止まるため使わない）。

import { useState } from "react";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { VoiceInputDock } from "@/modules/events/components/VoiceInputDock";
import { freeformExampleSentence } from "@/modules/events/lib/voice/batch-guide";
import { VOICE_GUIDE_STORAGE_KEY } from "@/modules/events/lib/voice/guide";
import {
  createScheduleDraft,
  EMPTY_EVENT_FORM,
  type EventFormValues,
} from "@/modules/events/types";

/** 疑似録音の待ち（`MOCK_RECORDING_MS`）を越える長さ。 */
const PAST_RECORDING_MS = 1200;
/** 疑似の区間が 1 つ出るまでの間隔（`MOCK_SEGMENT_STEP_MS`）を越える長さ。 */
const PAST_SEGMENT_MS = 250;
/** 疑似の区間を出し終え、確認のダイアログが開くまでの長さ（`MOCK_SEGMENT_TOTAL_MS`）。 */
const PAST_TRANSCRIBE_MS = 900;

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
async function startVoice(mode: "自由に話す" | "1つずつ") {
  await press("音声入力を開始");
  await act(async () => {
    screen.getByRole("button", { name: new RegExp(`^${mode}`) }).click();
  });
}

/** 疑似録音を進め、区間の文字と確認のダイアログが出るところまで進める。 */
async function openBatchDialog() {
  // 自由に話すときは、開いた瞬間には録らない（案内と例を読む時間を空ける）。押してから進める。
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

/** 録音中に表示されている全文（まだ出ていなければ null）。 */
function transcriptText(): string | null {
  return document.querySelector(".voice-panel__transcript")?.textContent ?? null;
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

describe("自由に話す", () => {
  it("空欄が多いときは、案内と 1 文の例を添えて「自由に話す」から始まる", async () => {
    stubFetch();
    const onChange = vi.fn();

    await mount(onChange);
    await startVoice("自由に話す");

    // 空欄が 3 つ以上あるので、自由に話すが既定になる。
    expect((screen.getByRole("radio", { name: "自由に話す" }) as HTMLInputElement).checked).toBe(
      true,
    );
    expect((screen.getByRole("radio", { name: "1つずつ" }) as HTMLInputElement).checked).toBe(
      false,
    );
    // 自由に話すのは 1 つの欄の話ではないので、質問は進めない。何を話すかは、
    // 自然な 1 文の例で見せる。聞き取れた文字の枠（「トークスクリプト」）は
    // 録音を始めた瞬間から出すので、押す前は見出しも無い。
    expect(screen.queryByText("トークスクリプト")).toBeNull();
    expect(
      screen.getByText("話し方の例：", { selector: ".voice-panel__say-label" }),
    ).toBeTruthy();
    expect(
      screen.getByText(freeformExampleSentence(), { selector: ".voice-panel__say-text" }),
    ).toBeTruthy();
    // 話す順のマスは、いま空欄の欄を参考として並べる（順番を決めずに話してよい）。
    expect(
      screen.getByText("入力する項目", { selector: ".voice-panel__plan-label" }),
    ).toBeTruthy();
    expect(screen.getByRole("list", { name: "話す順" })).toBeTruthy();
    // 1 欄ずつの「いまの値」と戻る・スキップは、自由に話すときは出さない。
    expect(screen.queryByText(/いまの値:/)).toBeNull();
    expect(screen.queryByRole("button", { name: "戻る" })).toBeNull();
    expect(screen.queryByRole("button", { name: "スキップ" })).toBeNull();
    expect(screen.queryByText("答えたら次へ")).toBeNull();
    // 自由に話すときは、任意の欄を既定で外す（話す量を増やさない）。
    expect(
      (screen.getByLabelText("任意の項目も聞く") as HTMLInputElement).checked,
    ).toBe(false);
    // 案内と例を読む時間を空けるため、開いた瞬間には録らない。押してから始める。
    expect(screen.queryByRole("button", { name: "録音を停止" })).toBeNull();
    expect(
      screen.getByText("録音を始める", { selector: ".voice-panel__talk" }),
    ).toBeTruthy();
    await press("録音を始める");
    expect(screen.getByRole("button", { name: "録音を停止" })).toBeTruthy();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("話す順のマスに、番号と欄の名前を並べる", async () => {
    stubFetch();

    await mount(vi.fn());
    await startVoice("自由に話す");

    const list = screen.getByRole("list", { name: "話す順" });
    // 必須の空欄を先に、8 枚まで。1 件目の日時は口に出しやすい名前にする。
    const labels = [...list.querySelectorAll(".voice-cell__label")].map(
      (node) => node.textContent,
    );
    expect(labels).toEqual([
      "イベント名",
      "開催日",
      "開始時間",
      "終了時間",
      "料金プラン名",
      "料金（円）",
      "場所",
      "郵便番号",
    ]);
    // 番号は「1.」の形。読み上げでは数えず、欄の名前だけを読む。
    const numbers = [...list.querySelectorAll(".voice-cell__number")];
    expect(numbers.map((node) => node.textContent)).toEqual([
      "1.",
      "2.",
      "3.",
      "4.",
      "5.",
      "6.",
      "7.",
      "8.",
    ]);
    expect(numbers.every((node) => node.getAttribute("aria-hidden") === "true")).toBe(true);
    // 矢印は並びの目安。読み上げからは外す。
    const seps = [...list.querySelectorAll(".voice-step__sep")];
    expect(seps).toHaveLength(8);
    expect(seps.every((node) => node.textContent === "→")).toBe(true);
    expect(seps.every((node) => node.getAttribute("aria-hidden") === "true")).toBe(true);
  });

  it("1つずつへ切り替えると、話す順の一覧は消える", async () => {
    stubFetch();

    await mount(vi.fn());
    await startVoice("自由に話す");
    expect(screen.getByRole("list", { name: "話す順" })).toBeTruthy();

    await chooseMode("1つずつ");

    // 1 欄ずつ聞くときは、話す順の目安は要らない。
    expect(screen.queryByRole("list", { name: "話す順" })).toBeNull();
    expect(
      screen.queryByText("入力する項目", { selector: ".voice-panel__plan-label" }),
    ).toBeNull();
  });

  it("自由に話すときは、後ろを黒透過の覆いで暗くする", async () => {
    stubFetch();

    await mount(vi.fn());
    await startVoice("自由に話す");

    const scrim = document.querySelector<HTMLElement>(".voice-scrim");
    expect(scrim).toBeTruthy();
    // 1 つの欄を聞いているわけではないので、穴を空けない。
    expect(scrim?.style.clipPath).toBe("");
  });

  it("「1つずつ」を選ぶと、1 欄ずつの質問に戻る", async () => {
    stubFetch();
    const onChange = vi.fn();

    await mount(onChange);
    await startVoice("自由に話す");
    await chooseMode("1つずつ");

    expect(screen.getByText("イベント名は？")).toBeTruthy();
    // 自由に話すときの例と「トークスクリプト」は消え、1 欄ずつの例だけが残る。
    expect(screen.queryByText("トークスクリプト")).toBeNull();
    expect(screen.getByText("例: 忘年会")).toBeTruthy();
    // 1 つずつなら、空欄でよい欄まで聞く（自由に話すと既定が違う）。
    expect(
      (screen.getByLabelText("任意の項目も聞く") as HTMLInputElement).checked,
    ).toBe(true);
    // 自由に話すに戻すと、また外れる。
    await chooseMode("自由に話す");
    expect(
      (screen.getByLabelText("任意の項目も聞く") as HTMLInputElement).checked,
    ).toBe(false);
  });

  it("録音中は、聞き取れた文字が区間ごとに順へ増える", async () => {
    stubFetch();
    const onChange = vi.fn();
    await mount(onChange);
    await startVoice("自由に話す");

    // 押す前は枠ごと無い。押すと同時に、空の枠とその見出しが出る
    // （最初の区間の文字が届くのは 2〜3 秒あと）。
    expect(transcriptText()).toBeNull();
    expect(screen.queryByText("トークスクリプト")).toBeNull();
    await press("録音を始める");
    expect(transcriptText()).toBe("");
    expect(
      screen.getByText("トークスクリプト", { selector: ".voice-panel__script-label" }),
    ).toBeTruthy();
    // 枠は話す順の一覧より上（左上の見出しと枠が、一覧の前に来る）。
    const script = document.querySelector(".voice-panel__script");
    const plan = document.querySelector(".voice-panel__plan");
    expect(script).toBeTruthy();
    expect(plan).toBeTruthy();
    expect(
      (script as Element).compareDocumentPosition(plan as Element) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    // 疑似録音が終わると、区間ごとに文字が届き始める。
    await act(async () => {
      vi.advanceTimersByTime(PAST_RECORDING_MS);
    });
    expect(transcriptText()).toBe("");
    await act(async () => {
      vi.advanceTimersByTime(PAST_SEGMENT_MS);
    });
    const first = transcriptText();
    expect(first).toBeTruthy();
    expect(first).toContain("忘年会");

    // 次の区間が届くと、前の文字を消さずに後ろへ足す。
    await act(async () => {
      vi.advanceTimersByTime(PAST_SEGMENT_MS);
    });
    const second = transcriptText();
    expect(second?.length ?? 0).toBeGreaterThan(first?.length ?? 0);
    expect(second?.startsWith(first as string)).toBe(true);
    // 文字が出ているだけでは、値はまだ入れない。
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("モックでは外部へ送らず、欄ごとの行を確認に並べる", async () => {
    const fetchMock = stubFetch();
    const onChange = vi.fn();

    await mount(onChange);
    await startVoice("自由に話す");

    const dialog = await openBatchDialog();
    expect(within(dialog).getByRole("heading", { name: "話した内容を確認" })).toBeTruthy();
    // 先頭に、入る欄の数と、入らなかった欄を出す。
    expect(dialog.textContent).toContain("つの欄に入れます。");

    // 当たった欄は、原文から抜き出した文字を初期値にする。
    expect(within(dialog).getByLabelText("イベント名")).toBeTruthy();
    expect(within(dialog).getByLabelText("開催日")).toBeTruthy();
    expect(within(dialog).getByLabelText("会場名")).toBeTruthy();
    expect(within(dialog).getByLabelText("金額")).toBeTruthy();
    expect((within(dialog).getByLabelText("イベント名") as HTMLInputElement).value).toBe(
      "忘年会",
    );
    // 開始が範囲（18時から20時）なら、終了時刻も埋まるので「入らなかった欄」にしない。
    expect(dialog.textContent).not.toContain("終了時刻");
    // 当たらなかったことは、話した言葉ではなく欄の名前で 1 行にまとめる。
    expect(dialog.textContent).toContain(
      "入らなかった欄: 料金プランの名前、市区町村、町域、番地",
    );
    expect(dialog.textContent).not.toContain("読み取れなかった部分");
    expect(dialog.textContent).not.toContain("行います");

    // 行の順は、パネルの一覧（話す順のマス）と同じ。割当は原文の順に返るので、
    // そのまま並べると「1. イベント名」と言った欄が確認では下のほうに出る。
    const dialogLabels = [...dialog.querySelectorAll(".voice-batch__label")].map(
      (node) => node.textContent,
    );
    const planIds = [...document.querySelectorAll(".voice-cell__label")].map(
      (node) => node.textContent,
    );
    expect(planIds.slice(0, 3)).toEqual(["イベント名", "開催日", "開始時間"]);
    expect(dialogLabels.slice(0, 3)).toEqual(["イベント名", "開催日", "開始時刻"]);
    // 一覧に出ている欄どうしの前後関係は、一覧と一致する。
    const seen = dialogLabels.filter((label) => planIds.includes(label) || label === "開始時刻");
    expect(seen.slice(0, 3)).toEqual(["イベント名", "開催日", "開始時刻"]);

    // マイクも外部も使わない。POST は 1 度も出ない。
    expect(fetchMock.mock.calls.every(([, init]) => init?.method !== "POST")).toBe(true);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("チェックを外した行は入れず、すべて入力を 1 回の更新にまとめる", async () => {
    stubFetch();
    const onChange = vi.fn();

    await mount(onChange);
    await startVoice("自由に話す");
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
    // 外した行は入らない。
    expect(value.venueName).toBe("");
  });

  it("編集した行は、編集後の文字で parse し直す", async () => {
    stubFetch();
    const onChange = vi.fn();

    await mount(onChange);
    await startVoice("自由に話す");
    const dialog = await openBatchDialog();

    const date = within(dialog).getByLabelText("開催日");
    await act(async () => {
      fireEvent.change(date, { target: { value: "12月6日" } });
    });
    await pressInDialog("すべて入力");

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(lastValue(onChange).schedules[0].eventDate).toMatch(/-12-06$/);
  });

  it("残りの必須が 2 つ以上なら、自由に話すまま続けられる", async () => {
    stubFetch();
    const onChange = vi.fn();

    await mount(onChange);
    await startVoice("自由に話す");
    const dialog = await openBatchDialog();

    // 開催日と会場名を外すと、必須の空欄が複数残る。
    await act(async () => {
      fireEvent.click(within(dialog).getByLabelText("開催日を取り込む"));
      fireEvent.click(within(dialog).getByLabelText("会場名を取り込む"));
    });
    await pressInDialog("すべて入力");

    expect(onChange).toHaveBeenCalledTimes(1);
    // 録音は自動で始めず、話す準備ができてから押してもらう。
    expect(screen.getByText(/^あと\d+つ。続けて話せます。$/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "録音を停止" })).toBeNull();
    expect(screen.getByRole("button", { name: "録音を始める" })).toBeTruthy();
  });

  it("残りの必須が 1 つなら、1 欄ずつへ切り替えて録音を始める", async () => {
    stubFetch();
    const onChange = vi.fn();

    // 場所とプラン名を埋めておき、会場名だけを残す。
    await mount(onChange, {
      ...EMPTY_EVENT_FORM,
      pricePlans: [{ ...EMPTY_EVENT_FORM.pricePlans[0], name: "一般" }],
      postalCode: "1500001",
      prefecture: "東京都",
      city: "渋谷区",
      town: "神宮前",
      addressLine: "1-2-3",
      building: "○○ビル3階",
    });
    await startVoice("自由に話す");
    const dialog = await openBatchDialog();

    await act(async () => {
      fireEvent.click(within(dialog).getByLabelText("会場名を取り込む"));
    });
    await pressInDialog("すべて入力");

    expect(onChange).toHaveBeenCalledTimes(1);
    // 残りが 1 つなので、1 欄ずつに切り替えて、そのまま録音を始める。
    expect(screen.getByText("残りの欄は1つずつ話します。")).toBeTruthy();
    expect(screen.getByText("会場は？")).toBeTruthy();
    expect(screen.getByRole("button", { name: "録音を停止" })).toBeTruthy();
  });

  it("初回ガイドは、自由に話すと 1 つずつの 2 択を同じ装飾で並べる", async () => {
    localStorage.removeItem(VOICE_GUIDE_STORAGE_KEY);
    stubFetch();

    await mount(vi.fn());

    expect(screen.getByText("話し方を選ぶと、入力が始まります。")).toBeTruthy();
    // どの催しに向く話しかは、ボタンの右端の札で示す。
    const batch = screen.getByRole("button", { name: /自由に話す/ });
    const single = screen.getByRole("button", { name: /1つずつ/ });
    expect(within(batch).getByText("自然な言葉で入力")).toBeTruthy();
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
    const batch = screen.getByRole("button", { name: /自由に話す/ });
    const single = screen.getByRole("button", { name: /1つずつ/ });
    expect(within(batch).getByText("自然な言葉で入力")).toBeTruthy();
    expect(within(single).getByText("複数日程・料金男女別向け")).toBeTruthy();
    expect(screen.queryByText("おすすめ")).toBeNull();
    expect(batch.className).toBe(single.className);

    await act(async () => {
      single.click();
    });
    expect(screen.getByText("イベント名は？")).toBeTruthy();
  });
});
