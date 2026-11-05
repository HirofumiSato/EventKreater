// @vitest-environment jsdom
//
// 郵便番号を音声で入れたあとの住所検索の見え方と、日時追加・男女別の質問の順の再発防止。
//
// 見るのは 5 つ。
//   1. 確定すると「住所を調べています」を出し、待ちの間は録音・戻る・スキップを止める
//   2. 応答が 1 件なら都道府県・市区町村・町域が入り、番地の録音へ進む
//   3. 0 件でも 1 行知らせて、進行は止めない
//   4. 日時を埋めて群を出るとき、題だけの「別の日程も追加しますか？」を出す
//   5. 費用の入口（プラン名の前）で男女別を聞き、「共通のまま」ならプラン名へ進む
//
// 郵便番号のターンから始めるため、ハーネスに入力欄を置いて focus する。
// `VoiceInputDock` は focusin で欄の id を控え、音声モードの開始位置に使う。
// 郵便番号 API は手動で解決できる Promise にし、モック可否の問い合わせと URL で見分ける。

import { useState } from "react";
import { act, cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { VoiceInputDock } from "@/modules/events/components/VoiceInputDock";
import { VOICE_GUIDE_STORAGE_KEY } from "@/modules/events/lib/voice/guide";
import {
  resetPostalCodeSearch,
  type PostalCodeResult,
} from "@/modules/events/lib/postal-code-search";
import {
  EMPTY_EVENT_FORM,
  createScheduleDraft,
  type EventFormValues,
} from "@/modules/events/types";

/** 疑似録音と文字化の待ち（`MOCK_RECORDING_MS` / `MOCK_TRANSCRIBE_MS`）を越える長さ。 */
const PAST_RECORDING_MS = 1200;
const PAST_TRANSCRIBE_MS = 350;

/** 郵便番号の入力欄の id。`VOICE_FIELDS` の `postalCode` と同じ。 */
const POSTAL_CODE_INPUT_ID = "event-postal-code";

/** 郵便番号 API の応答を、テストから手動で返すための控え。 */
interface PostalStub {
  /** 郵便番号 API へ問い合わせた URL（呼ばれた順）。 */
  urls: string[];
  /** 返事を待っている問い合わせの解決口。 */
  resolvers: Array<(body: unknown) => void>;
}

/**
 * `fetch` を差し替える。
 *
 * モック可否の問い合わせ（`/api/v1/voice/transcriptions`）はすぐ `{ mock: true }` を返し、
 * 郵便番号 API（`/api/v1/geo/postal-codes/...`）だけを手動で解決できる Promise にする。
 */
function stubFetch(): PostalStub {
  const stub: PostalStub = { urls: [], resolvers: [] };
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (!url.includes("/api/v1/geo/postal-codes/")) {
        return Promise.resolve(Response.json({ mock: true }));
      }
      stub.urls.push(url);
      return new Promise<Response>((resolve) => {
        stub.resolvers.push((body) => {
          resolve({ ok: true, json: async () => body } as unknown as Response);
        });
      });
    }),
  );
  return stub;
}

/** 待っている郵便番号 API の問い合わせへ応答し、描き直しまで流す。 */
async function respondPostal(stub: PostalStub, results: PostalCodeResult[]) {
  const resolve = stub.resolvers.shift();
  if (!resolve) throw new Error("郵便番号 API の問い合わせがありません");
  await act(async () => {
    resolve({ results });
  });
  // 応答の JSON 読み取りと、確定後の描き直しをもう一度流す。
  await act(async () => {});
}

function Harness({
  onChange,
  initial,
  focusId,
}: {
  onChange: (next: EventFormValues) => void;
  initial?: EventFormValues;
  focusId: string;
}) {
  const [value, setValue] = useState<EventFormValues>(initial ?? EMPTY_EVENT_FORM);
  return (
    <>
      {/* 音声モードの開始位置を決める入力欄。部品の外にある本物の欄の代わり。 */}
      <input id={focusId} aria-label="音声の開始位置" />
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

/** 部品を描き、開始位置の欄へ focus してから、開いたときの問い合わせを済ませる。 */
async function mount(options: {
  onChange: (next: EventFormValues) => void;
  initial?: EventFormValues;
  focusId?: string;
}) {
  const focusId = options.focusId ?? POSTAL_CODE_INPUT_ID;
  render(<Harness onChange={options.onChange} initial={options.initial} focusId={focusId} />);
  await act(async () => {});
  // 開始位置は focusin で控えられる。音声モードを開く前に当てておく。
  await act(async () => {
    document.getElementById(focusId)?.focus();
  });
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

/**
 * 開いているダイアログの中の操作を押す。
 *
 * 閉じる印には同じ読み上げ名（`closeLabel`）が付くため、読み上げ名ではなく
 * ボタンの文字で選ぶ。背景のボタンは紙の外にあるので、ここには出てこない。
 */
async function pressInDialog(name: string) {
  await act(async () => {
    within(screen.getByRole("dialog")).getByText(name).click();
  });
}

/** 直近に渡した値。 */
function lastValue(onChange: { mock: { calls: unknown[][] } }): EventFormValues {
  return onChange.mock.calls.at(-1)?.[0] as EventFormValues;
}

/** 主ボタン（話す・言い直す）と、戻る・スキップの 3 つ。 */
function panelButtons() {
  return {
    talk: screen.getByRole("button", { name: /^(話す|言い直す)$/ }) as HTMLButtonElement,
    back: screen.getByRole("button", { name: "戻る" }) as HTMLButtonElement,
    skip: screen.getByRole("button", { name: "スキップ" }) as HTMLButtonElement,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  // 初回の案内は見たいものではないので、閉じた状態から始める。
  localStorage.setItem(VOICE_GUIDE_STORAGE_KEY, "1");
  // 郵便番号の検索結果はモジュールに控えられる。前の試験の結果を持ち越さない。
  resetPostalCodeSearch();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  localStorage.clear();
  resetPostalCodeSearch();
});

describe("郵便番号の住所検索", () => {
  it("確定すると「住所を調べています」を出し、待ちの間は録音・戻る・スキップを止める", async () => {
    const stub = stubFetch();
    const onChange = vi.fn();

    await mount({ onChange });
    await press("音声入力を開始");
    await passMockWait();
    // 郵便番号は形が閉じているので自動で入り、そのまま住所の検索が始まる。
    expect(screen.getByText("住所を調べています")).toBeTruthy();
    expect(stub.urls).toHaveLength(1);
    expect(stub.urls[0]).toContain("/api/v1/geo/postal-codes/1500001");

    // 待ちの間に録音を始めさせない。戻る・スキップも止める。
    const buttons = panelButtons();
    expect(buttons.talk.disabled).toBe(true);
    expect(buttons.talk.getAttribute("data-state")).toBe("busy");
    expect(buttons.back.disabled).toBe(true);
    expect(buttons.skip.disabled).toBe(true);
  });

  it("住所が 1 件見つかると 3 欄に入り、番地の録音へ進む", async () => {
    const stub = stubFetch();
    const onChange = vi.fn();

    await mount({ onChange });
    await press("音声入力を開始");
    await passMockWait();

    await respondPostal(stub, [
      { prefecture: "東京都", city: "渋谷区", town: "神宮前" },
    ]);

    // 都道府県・市区町村・町域は onChange の値に入る。
    const value = lastValue(onChange);
    expect(value.prefecture).toBe("東京都");
    expect(value.city).toBe("渋谷区");
    expect(value.town).toBe("神宮前");

    // 待ちは解け、次の欄（番地）の録音に移る。
    expect(screen.queryByText("住所を調べています")).toBeNull();
    expect(screen.getByText("番地は？")).toBeTruthy();
    expect(screen.getByRole("button", { name: "録音を停止" })).toBeTruthy();
  });

  it("住所が 0 件でも 1 行知らせて、次の欄の録音へ進む", async () => {
    const stub = stubFetch();
    const onChange = vi.fn();

    await mount({ onChange });
    await press("音声入力を開始");
    await passMockWait();

    await respondPostal(stub, []);

    // 補完できなかったことを、黙って進まずに 1 行で知らせる。
    expect(
      screen.getByText("住所を調べられませんでした。手で入力してください。"),
    ).toBeTruthy();
    // 進行は止めない。住所の 3 欄が空のままなので、次の欄（都道府県）の録音へ進む。
    expect(screen.getByText("都道府県は？")).toBeTruthy();
    expect(screen.getByRole("button", { name: "録音を停止" })).toBeTruthy();

    // 住所は入っていない（郵便番号だけが入っている）。
    const value = lastValue(onChange);
    expect(value.postalCode).toBe("1500001");
    expect(value.prefecture).toBe("");
  });
});

describe("日時追加のダイアログ", () => {
  it("日時を埋めて群を出るとき、題だけの「別の日程も追加しますか？」を出す", async () => {
    stubFetch();
    const onChange = vi.fn();
    // 開催日と開始時刻だけ埋めた状態から、終了時刻を音声で入れて群を抜ける。
    const initial: EventFormValues = {
      ...EMPTY_EVENT_FORM,
      schedules: [
        createScheduleDraft({
          key: "schedule-test",
          eventDate: "2026-12-05",
          startTime: "18:00",
        }),
      ],
    };

    await mount({ onChange, initial, focusId: "schedule-end-schedule-test" });
    await press("音声入力を開始");
    await passMockWait();
    // 終了時刻は形が閉じているので自動で入る。群を出る質問がそのまま出る。
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByRole("heading", { name: "別の日程も追加しますか？" })).toBeTruthy();
    // 題の id は変えない（読み上げの対応を保つ）。
    expect(dialog.getAttribute("aria-labelledby")).toBe("voice-branch-schedule-title");
    // 説明文は持たない。空の `dialog__content` だけが残る。
    expect(dialog.querySelector(".dialog__body")).toBeNull();
    expect(dialog.textContent).not.toContain("日程を増やすと");
  });
});

describe("費用の入口の男女別の質問", () => {
  it("最終の終了時刻を入れると、男女別を聞いてからプラン名へ進む", async () => {
    stubFetch();
    const onChange = vi.fn();
    // 終了時刻だけ空けた最終行から始める。費用は共通の 1 行（名前・金額は空）のまま。
    const initial: EventFormValues = {
      ...EMPTY_EVENT_FORM,
      schedules: [
        createScheduleDraft({ key: "schedule-test", eventDate: "2026-12-05", startTime: "18:00" }),
      ],
    };

    await mount({ onChange, initial, focusId: "schedule-end-schedule-test" });
    await press("音声入力を開始");
    await passMockWait();

    // まず日時の群を出る質問（別の日程）に答える。終了時刻は自動で入っている。
    expect(
      within(screen.getByRole("dialog")).getByRole("heading", {
        name: "別の日程も追加しますか？",
      }),
    ).toBeTruthy();
    await pressInDialog("追加しない");

    // 費用の入口で男女別を聞く。プラン名より前であることが、この並びの要点。
    const genderDialog = screen.getByRole("dialog");
    expect(
      within(genderDialog).getByRole("heading", { name: "男女別の費用を設定しますか" }),
    ).toBeTruthy();
    // 金額はまだ無い時点なので、引き継ぎの説明は出さない。
    expect(genderDialog.textContent).toContain("男性と女性で金額を分けられます。");
    expect(genderDialog.textContent).not.toContain("引き継ぎ");
    await pressInDialog("共通のまま");

    // 共通のままなら女性用の金額へ飛ばず、プラン名を聞く。もう男女別は聞き直さない。
    expect(screen.getByText("プラン名は？")).toBeTruthy();
    expect(screen.queryByRole("dialog")).toBeNull();
    // プラン名の録音が、その場で始まっている。
    expect(screen.getByRole("button", { name: "録音を停止" })).toBeTruthy();
  });
});
