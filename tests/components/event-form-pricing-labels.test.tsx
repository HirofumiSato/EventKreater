// @vitest-environment jsdom
//
// 編集画面の料金プランの見出しと、ステップ見出しの開閉を固定する。
//
// 見るのは 3 つ。
//   1. 共通料金の見出しは「プラン1」「プラン2」と並び順で付く
//   2. 男女別でも 1 組＝1 プランなので、組の見出しは「プラン1」から始まる
//   3. 編集画面のステップ見出しは開閉しない（本文を押しても何も起きない）

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EventForm } from "@/modules/events/components/EventForm";
import { PricePlansSection } from "@/modules/events/components/EventFormSections";
import {
  createPricePlanDraft,
  EMPTY_EVENT_FORM,
  withGenderPricing,
  type EventFormValues,
} from "@/modules/events/types";

afterEach(cleanup);

function valueWithPlans(pricePlans: EventFormValues["pricePlans"]): EventFormValues {
  return { ...EMPTY_EVENT_FORM, pricePlans };
}

describe("料金プランの見出し", () => {
  it("共通料金は並び順で「プラン1」「プラン2」と付く", () => {
    render(
      <PricePlansSection
        value={valueWithPlans([
          createPricePlanDraft({ name: "一般", amount: "3000" }),
          createPricePlanDraft({ name: "学生", amount: "2000" }),
        ])}
        onChange={() => {}}
      />,
    );

    expect(screen.getByLabelText("プラン1")).toBeTruthy();
    expect(screen.getByLabelText("プラン2")).toBeTruthy();
    // 欄の名前は「プラン名」ではなく、並び順で示す。
    expect(screen.queryByLabelText("プラン名")).toBeNull();
  });

  it("男女別は 1 組＝1 プランなので、組の見出しは「プラン1」から始まる", () => {
    render(
      <PricePlansSection
        value={valueWithPlans(withGenderPricing([createPricePlanDraft({ name: "一般" })]))}
        onChange={() => {}}
      />,
    );

    expect(screen.getByLabelText("プラン1")).toBeTruthy();
    expect(screen.queryByLabelText("プラン名")).toBeNull();
  });
});

describe("編集画面のステップ", () => {
  it("見出しは開閉ボタンにせず、本文を押しても状態を持たない", () => {
    const { container } = render(
      <EventForm
        value={EMPTY_EVENT_FORM}
        onChange={vi.fn()}
        onSubmit={vi.fn()}
        submitting={false}
        submitLabel="保存する"
        hideSubmit
      />,
    );

    // 開閉の印（`aria-expanded` と `.event-step__toggle`）を持たない。
    expect(container.querySelectorAll(".event-step__toggle").length).toBe(0);
    expect(container.querySelectorAll("[aria-expanded]").length).toBe(0);
    expect(container.querySelectorAll(".event-step__heading-inner").length).toBe(5);
    // 本文は開いたまま描かれる。
    expect(container.querySelectorAll(".event-step__body").length).toBe(5);
  });
});
