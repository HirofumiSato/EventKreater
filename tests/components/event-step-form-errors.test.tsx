// @vitest-environment jsdom
//
// 保存・プレビューで足りない欄があったときの見せ方（`EventStepForm`）。
// ステップを開いてスクロールするだけだと、どこが必須なのか分からない。
// 足りない欄のすぐ下に理由を出し、その欄へフォーカスを移す。
//
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EventStepForm } from "@/modules/events/components/EventStepForm";
import {
  EMPTY_EVENT_FORM,
  createPricePlanDraft,
  createScheduleDraft,
  type EventFormValues,
} from "@/modules/events/types";

function Harness({
  initial,
  onSaveDraft,
}: {
  initial: EventFormValues;
  onSaveDraft: () => void;
}) {
  const [value, setValue] = useState(initial);
  return (
    <EventStepForm
      value={value}
      onChange={setValue}
      onSubmit={() => {}}
      submitting={false}
      canSaveDraft
      onSaveDraft={onSaveDraft}
      flyerSlot={<div />}
      seedKey="new"
      ready
    />
  );
}

/** 基本情報だけ埋めた値。最初に開くのは料金ステップになる。 */
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
    venueName: "河川公園",
  };
}

afterEach(cleanup);

describe("保存できないときの欄ごとのエラー", () => {
  it("イベント名が空なら、その欄の下に理由を出してフォーカスを移す", async () => {
    const user = userEvent.setup();
    const onSaveDraft = vi.fn();
    render(<Harness initial={EMPTY_EVENT_FORM} onSaveDraft={onSaveDraft} />);

    await user.click(screen.getByRole("button", { name: "下書き保存" }));

    expect(onSaveDraft).not.toHaveBeenCalled();
    expect(screen.getByText("イベント名を入れてください。")).toBeTruthy();

    const title = screen.getByRole("textbox", { name: /イベント名/ }) as HTMLInputElement;
    expect(document.activeElement).toBe(title);
    expect(title.getAttribute("aria-invalid")).toBe("true");
    expect(title.getAttribute("aria-describedby")).toBe("event-title-error");
  });

  it("直すと、その欄のエラーは消える", async () => {
    const user = userEvent.setup();
    render(<Harness initial={EMPTY_EVENT_FORM} onSaveDraft={() => {}} />);

    await user.click(screen.getByRole("button", { name: "下書き保存" }));
    expect(screen.getByText("イベント名を入れてください。")).toBeTruthy();

    await user.type(screen.getByRole("textbox", { name: /イベント名/ }), "秋の芋煮会");
    expect(screen.queryByText("イベント名を入れてください。")).toBeNull();
  });

  it("金額が空なら、金額の欄の下に理由を出してフォーカスを移す", async () => {
    const user = userEvent.setup();
    render(<Harness initial={valueBeforePricing()} onSaveDraft={() => {}} />);

    await user.click(screen.getByRole("button", { name: "下書き保存" }));

    expect(screen.getByText("金額を入れてください。")).toBeTruthy();
    const amount = screen.getByRole("spinbutton", { name: "金額（円）" }) as HTMLInputElement;
    expect(document.activeElement).toBe(amount);
    expect(amount.getAttribute("aria-invalid")).toBe("true");
  });
});
