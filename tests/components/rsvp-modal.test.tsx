// @vitest-environment jsdom
//
// 出欠の層（`DynamicRsvpBox`）の再発防止。
//
// 直したのは 4 つで、どれも「選択すると欄が出る」形に戻ると壊れる。
//   1. 性別・日時・料金は最初から出す（欠席なら消さずにグレーアウトする）
//   2. 性別別の料金プランしか無い催しでも、料金の欄が消えない
//   3. 日時は 3 件までを 1 行に並べる
//   4. ログイン中は名前の欄と「アカウントを切り替える」を出さない
//
// 見るのは DOM の形（`field--disabled`・`disabled`・`checked`）と、送る名前。

import { useState, type ComponentProps, type ReactNode } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DynamicRsvpBox } from "@/modules/attendance/components/DynamicRsvpBox";
import type {
  EventPricePlanOption,
  EventScheduleOption,
  PriceAudience,
} from "@/modules/events/types";

// `next/link` は Router の文脈を要求する。ここで見たいのは名前の欄と切り替えの有無だけなので、
// 素の `<a>` に置き換える。
vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

function plan(id: string, audience: PriceAudience, amount = 3000): EventPricePlanOption {
  return {
    id,
    name: `プラン${id}`,
    audience,
    amount,
    note: null,
    price: `${amount.toLocaleString("ja-JP")}円`,
  };
}

function schedule(id: string, eventDate: string): EventScheduleOption {
  return {
    id,
    eventDate,
    startTime: "13:00",
    endTime: "21:00",
    eventTime: "13:00〜21:00",
  };
}

const THREE_SCHEDULES = [
  schedule("s1", "2026-11-21"),
  schedule("s2", "2026-11-22"),
  schedule("s3", "2026-11-23"),
];

const GENDERED_PLANS = [plan("any", "ANY", 1500), plan("male", "MALE"), plan("female", "FEMALE")];

type Props = ComponentProps<typeof DynamicRsvpBox>;

function Harness(props: Partial<Props>) {
  const [open, setOpen] = useState(true);
  return (
    <DynamicRsvpBox
      eventId="event-1"
      schedules={THREE_SCHEDULES}
      pricePlans={GENDERED_PLANS}
      discounts={[]}
      initialRsvp={null}
      capacity={null}
      attendingCount={0}
      waitlistCount={0}
      closed={false}
      onCountChange={() => {}}
      open={open}
      onOpenChange={setOpen}
      {...props}
    />
  );
}

function renderBox(props: Partial<Props> = {}) {
  const utils = render(<Harness {...props} />);
  return { ...utils, form: utils.container.querySelector("#rsvp-form") as HTMLFormElement };
}

function radios(container: HTMLElement, name: string): HTMLInputElement[] {
  return Array.from(container.querySelectorAll<HTMLInputElement>(`input[name="${name}"]`));
}

function fieldOf(input: HTMLInputElement): HTMLElement {
  return input.closest("fieldset") as HTMLElement;
}

beforeEach(() => {
  // `dismissOnBack` は開いたときに履歴を 1 つ積み、閉じるときに戻す。
  // jsdom の履歴移動は「未実装」の警告を出すので、戻る操作だけ無害にする。
  vi.spyOn(window.history, "back").mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("初期表示", () => {
  it("出席の欄（性別・日時・料金）を、選ぶ前から出す", () => {
    renderBox();
    expect(screen.getByText("性別")).toBeTruthy();
    expect(screen.getByText("出席する日時")).toBeTruthy();
    expect(screen.getByText("料金プラン")).toBeTruthy();
  });

  it("出席が既定なので、性別と日時の札は押せる", () => {
    const { container } = renderBox();
    expect(radios(container, "gender").every((input) => !input.disabled)).toBe(true);
    expect(radios(container, "schedule").every((input) => !input.disabled)).toBe(true);
  });
});

describe("欠席にしたとき", () => {
  it("欄は消さず、残したまま押せなくする", () => {
    const { container } = renderBox();
    const declined = container.querySelector<HTMLInputElement>('input[name="rsvp"][value="DECLINED"]');
    expect(declined).toBeTruthy();
    fireEvent.click(declined!);

    // 見出しは残る。
    expect(screen.getByText("性別")).toBeTruthy();
    expect(screen.getByText("出席する日時")).toBeTruthy();
    expect(screen.getByText("料金プラン")).toBeTruthy();

    // 入力は残るが、どれも押せない。
    for (const input of radios(container, "gender")) expect(input.disabled).toBe(true);
    for (const input of radios(container, "schedule")) expect(input.disabled).toBe(true);
    for (const input of radios(container, "price-plan")) expect(input.disabled).toBe(true);
    for (const input of radios(container, "gender")) {
      expect(fieldOf(input).classList.contains("field--disabled")).toBe(true);
    }
  });

  it("出席に戻すと、また押せる", () => {
    const { container } = renderBox();
    fireEvent.click(container.querySelector('input[name="rsvp"][value="DECLINED"]')!);
    fireEvent.click(container.querySelector('input[name="rsvp"][value="ATTENDING"]')!);
    expect(radios(container, "gender").some((input) => !input.disabled)).toBe(true);
    expect(radios(container, "schedule").every((input) => !input.disabled)).toBe(true);
  });
});

describe("性別と料金プラン", () => {
  it("性別を選ぶ前は、男女別の札を残したまま押せなくする", () => {
    const { container } = renderBox();
    const byAudience = (audience: PriceAudience) =>
      container.querySelector<HTMLInputElement>(`input[name="price-plan"][data-audience="${audience}"]`)!;

    expect(byAudience("ANY").disabled).toBe(false);
    expect(byAudience("MALE").disabled).toBe(true);
    expect(byAudience("FEMALE").disabled).toBe(true);
  });

  it("男性を選ぶと男性プランだけ押せる（女性プランは消さない）", () => {
    const { container } = renderBox();
    const byAudience = (audience: PriceAudience) =>
      container.querySelector<HTMLInputElement>(`input[name="price-plan"][data-audience="${audience}"]`)!;

    fireEvent.click(container.querySelector('input[name="gender"][value="MALE"]')!);

    expect(byAudience("ANY").disabled).toBe(false);
    expect(byAudience("MALE").disabled).toBe(false);
    expect(byAudience("FEMALE").disabled).toBe(true);
    expect(container.querySelectorAll('input[name="price-plan"]')).toHaveLength(3);
  });

  it("女性に選び直すと、押せる札が入れ替わる", () => {
    const { container } = renderBox();
    const byAudience = (audience: PriceAudience) =>
      container.querySelector<HTMLInputElement>(`input[name="price-plan"][data-audience="${audience}"]`)!;

    fireEvent.click(container.querySelector('input[name="gender"][value="MALE"]')!);
    fireEvent.click(container.querySelector('input[name="gender"][value="FEMALE"]')!);

    expect(byAudience("MALE").disabled).toBe(true);
    expect(byAudience("FEMALE").disabled).toBe(false);
  });

  it("男女別プランが 1 件だけでも、料金の欄と札を出す（以前は欄ごと消えていた）", () => {
    const { container } = renderBox({ pricePlans: [plan("male", "MALE")] });
    expect(screen.getByText("料金プラン")).toBeTruthy();
    expect(radios(container, "price-plan")).toHaveLength(1);

    fireEvent.click(container.querySelector('input[name="gender"][value="MALE"]')!);
    const only = radios(container, "price-plan")[0];
    expect(only.disabled).toBe(false);
    expect(only.checked).toBe(true);
  });

  it("性別を選んだのに合うプランが無ければ、案内を出して札は押せないままにする", () => {
    const { container } = renderBox({ pricePlans: [plan("female", "FEMALE")] });
    fireEvent.click(container.querySelector('input[name="gender"][value="MALE"]')!);
    expect(
      screen.getByText("この性別で選べる料金プランがありません。幹事に確認してください。"),
    ).toBeTruthy();
    expect(radios(container, "price-plan").every((input) => input.disabled)).toBe(true);
  });
});

describe("出席する日時", () => {
  it("3 件を 1 つの横並びの組に入れる（縦積みにしない）", () => {
    const { container } = renderBox();
    const group = container.querySelector(".choice-group--schedule");
    expect(group).toBeTruthy();
    expect(group!.querySelectorAll(".choice--schedule")).toHaveLength(3);
    expect(group!.closest("fieldset")!.classList.contains("field--disabled")).toBe(false);
  });

  it("選んだ日時だけを選択にする", () => {
    const { container } = renderBox();
    fireEvent.click(container.querySelector('input[name="schedule"][value="s2"]')!);
    const checked = radios(container, "schedule").filter((input) => input.checked);
    expect(checked).toHaveLength(2);
    expect(checked.map((input) => input.value)).toEqual(["s1", "s2"]);
  });

  it("日時を複数選べる（2 日目と 3 日目だけにもできる）", () => {
    const { container } = renderBox();
    fireEvent.click(container.querySelector('input[name="schedule"][value="s1"]')!);
    fireEvent.click(container.querySelector('input[name="schedule"][value="s3"]')!);
    const checked = radios(container, "schedule").filter((input) => input.checked);
    expect(checked.map((input) => input.value)).toEqual(["s3"]);
  });

  it("1 件も選ばなければ、案内を出して送信を止める", () => {
    const { container } = renderBox();
    fireEvent.click(container.querySelector('input[name="schedule"][value="s1"]')!);
    expect(screen.getByText("参加する日を1つ以上選んでください。")).toBeTruthy();
    const submit = container.querySelector('button[form="rsvp-form"]') as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
  });
});

describe("出欠の文言", () => {
  it("選択肢は「参加」「欠席」だけにし、小さい補足を出さない", () => {
    renderBox();
    expect(screen.getByText("参加")).toBeTruthy();
    expect(screen.getByText("欠席")).toBeTruthy();
    expect(screen.queryByText("あとから変更できます")).toBeNull();
    expect(screen.queryByText("案内は届きません")).toBeNull();
    expect(screen.queryByText("出席する")).toBeNull();
  });

  it("満員なら「参加を希望」にする", () => {
    renderBox({ capacity: 1, attendingCount: 1 });
    expect(screen.getByText("参加を希望")).toBeTruthy();
  });

  it("コメントは summary も見出しも「コメント」にし、任意の札を残す", () => {
    const { container } = renderBox();
    const summary = container.querySelector(".rsvp-extras__label")!;
    expect(summary.textContent).toContain("コメント");
    expect(summary.textContent).toContain("任意");
    expect(container.querySelector('label[for="rsvp-comment"]')).toBeNull();
    expect(screen.getByLabelText("コメント")).toBeTruthy();
  });
});

describe("参加人数", () => {
  it("既定は 1 人", () => {
    const { container } = renderBox();
    const input = container.querySelector<HTMLInputElement>("#rsvp-party-size")!;
    expect(input.value).toBe("1");
    expect(input.min).toBe("1");
    expect(input.max).toBe("20");
  });

  it("欠席にすると押せなくする", () => {
    const { container } = renderBox();
    fireEvent.click(container.querySelector('input[name="rsvp"][value="DECLINED"]')!);
    expect(container.querySelector<HTMLInputElement>("#rsvp-party-size")!.disabled).toBe(true);
  });

  it("3 人で送ると、日時と人数を body に載せる", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      new Response(JSON.stringify({ success: true, myRsvp: null }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { container, form } = renderBox();
    fireEvent.change(container.querySelector("#rsvp-party-size")!, { target: { value: "3" } });
    fireEvent.click(container.querySelector('input[name="schedule"][value="s2"]')!);
    await act(async () => {
      fireEvent.submit(form);
    });

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(body.partySize).toBe(3);
    expect(body.scheduleIds).toEqual(["s1", "s2"]);
  });
});

describe("ログインしているとき", () => {
  const loginHref = "/auth/register?next=%2Fevents%2Fevent-1";

  it("名前の欄を出さない", () => {
    const { container } = renderBox({ memberName: "佐藤 みのり", loginHref });
    expect(container.querySelector("#rsvp-name")).toBeNull();
    expect(screen.queryByText(/お名前/)).toBeNull();
  });

  it("「アカウントを切り替える」を出さない", () => {
    renderBox({ memberName: "佐藤 みのり", loginHref });
    expect(screen.queryByText("アカウントを切り替える")).toBeNull();
    expect(screen.getByText("佐藤 みのり さんとして答えます")).toBeTruthy();
  });

  it("送る名前は会員名。空の入力で送らない", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      new Response(
        JSON.stringify({
          success: true,
          myRsvp: {
            id: "rsvp-1",
            name: "佐藤 みのり",
            status: "ATTENDING",
            gender: null,
            comment: null,
            scheduleId: "s1",
            pricePlanId: "any",
            discounts: [],
            waitlistPosition: null,
          },
          attendingCount: 1,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { form } = renderBox({ memberName: "佐藤 みのり", loginHref });
    await act(async () => {
      fireEvent.submit(form);
    });

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(body.name).toBe("佐藤 みのり");
  });
});

describe("ログインしていないとき", () => {
  it("名前の欄を出し、ログインの案内を出す", () => {
    const { container } = renderBox({ loginHref: "/auth/register?next=%2Fevents%2Fevent-1" });
    expect(container.querySelector("#rsvp-name")).toBeTruthy();
    expect(screen.getByText(/すると、あとから答えを変えられます。/)).toBeTruthy();
  });

  it("送る名前は入力の前後の空白を落とす", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      new Response(JSON.stringify({ success: true, myRsvp: null }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { container, form } = renderBox();
    fireEvent.change(container.querySelector("#rsvp-name")!, { target: { value: "  田中  " } });
    await act(async () => {
      fireEvent.submit(form);
    });

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(body.name).toBe("田中");
  });
});
