// @vitest-environment jsdom
//
// ステップ入力の自動開閉の再発防止（`EventStepForm`）。
//
// 金額は最初の 1 桁で料金ステップが「完了」になる。そこで自動展開すると、打っている
// 金額欄ごと DOM から消えて、スマホではフォーカスが外れていた。ここで見るのは 3 つ。
//   1. 金額を打っているあいだは料金ステップを閉じず、フォーカスも金額欄に残る
//   2. 金額欄からフォーカスが外れたら、保留していた開催場所を開く
//   3. 料金ステップの見出しへフォーカスしたときは、開催場所を開かずに自分で畳める

import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { EventStepForm } from "@/modules/events/components/EventStepForm";
import {
  createPricePlanDraft,
  createScheduleDraft,
  EMPTY_EVENT_FORM,
  type EventFormValues,
} from "@/modules/events/types";

/** 基本情報だけ埋めた値。料金が空なので、開くのは料金ステップになる。 */
function valueBeforePricing(): EventFormValues {
  return {
    ...EMPTY_EVENT_FORM,
    title: "秋の芋煮会",
    schedules: [
      createScheduleDraft({
        key: "schedule-initial",
        eventDate: "2026-11-23",
        startTime: "11:00",
        endTime: "15:00",
      }),
    ],
    pricePlans: [createPricePlanDraft({ key: "plan-initial", name: "一般", amount: "" })],
  };
}

/**
 * 入力値を親で持つ。`EventStepForm` は値を受け取るだけなので、
 * 実際の画面と同じように 1 文字ごとの変更を返す。
 */
function Harness({ initial }: { initial: EventFormValues }) {
  const [value, setValue] = useState(initial);
  return (
    <EventStepForm
      value={value}
      onChange={setValue}
      onSubmit={() => {}}
      submitting={false}
      flyerSlot={<div />}
      seedKey="new"
      ready
    />
  );
}

function renderForm() {
  render(<Harness initial={valueBeforePricing()} />);
  const amount = screen.getByLabelText("金額（円）") as HTMLInputElement;
  const pricingToggle = document.getElementById(
    "event-step-pricing-toggle",
  ) as HTMLButtonElement;
  const locationToggle = document.getElementById(
    "event-step-location-toggle",
  ) as HTMLButtonElement;
  return { amount, pricingToggle, locationToggle };
}

afterEach(cleanup);

describe("ステップの自動開閉", () => {
  it("金額を入力しているあいだは料金ステップを閉じず、フォーカスも金額欄に残す", async () => {
    const user = userEvent.setup();
    const { amount, pricingToggle, locationToggle } = renderForm();

    expect(pricingToggle.getAttribute("aria-expanded")).toBe("true");

    await user.click(amount);
    await user.type(amount, "3");

    // 1 桁で料金ステップは「完了」になるが、打っているあいだは畳まない。
    expect(pricingToggle.getAttribute("aria-expanded")).toBe("true");
    expect(locationToggle.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(amount);
  });

  it("金額欄からフォーカスが外れたら、保留していた開催場所を開く", async () => {
    const user = userEvent.setup();
    const { amount, pricingToggle, locationToggle } = renderForm();

    await user.click(amount);
    await user.type(amount, "3");
    expect(locationToggle.getAttribute("aria-expanded")).toBe("false");

    act(() => amount.blur());

    await waitFor(() =>
      expect(locationToggle.getAttribute("aria-expanded")).toBe("true"),
    );
    // 済んだ料金ステップは、保留していた展開のときに畳む。
    expect(pricingToggle.getAttribute("aria-expanded")).toBe("false");
  });

  it("料金ステップの見出しへフォーカスしたら、開催場所を開かずに料金ステップだけを畳む", async () => {
    const user = userEvent.setup();
    const { amount, pricingToggle, locationToggle } = renderForm();

    await user.click(amount);
    await user.type(amount, "3");

    // 自分で見出しを押しに行ったので、保留した展開は捨てる。
    act(() => pricingToggle.focus());
    await user.click(pricingToggle);

    expect(pricingToggle.getAttribute("aria-expanded")).toBe("false");
    expect(locationToggle.getAttribute("aria-expanded")).toBe("false");
  });
});
