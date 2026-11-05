// @vitest-environment jsdom
//
// 帯（`QuotaStatusBanner`）の導線の再発防止。
//
// ヘッダーの「プラン・カード管理」は `/organizer/plan` へのリンクになり、帯からは
// その画面へ進む。単発チケットだけは、その場で買えるよう専用の層を開く。
// ここで見るのは 6 つ。
//   1. 未加入は「月額プランを見る」を `/organizer/plan` へのリンクとして出す
//   2. 未加入は「単発チケットを買う」で単発チケットの層を開く
//   3. 公開し放題プランに加入中は、2 つの導線とも出さない
//   4. 支払いに問題がある間は、単発のボタンを止めて月額のリンクだけを残す
//   5. 0円キャンペーンで受け取れるときは、ボタンを「0円チケットを受け取る」にする
//   6. 残数の読み込み中は、同じ高さの場所取りを出して導線を出さない
//
// 購入したあとの動きは呼び出し元の仕事。ここでは `onPurchaseTicket` を呼ばずに、
// 層が開くところまでを見る。

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { QuotaStatusBanner } from "@/modules/billing/components/QuotaStatusBanner";
import type { PricingQuote, UserQuota } from "@/modules/events/types";

function quote(target: PricingQuote["target"], chargedPrice: number): PricingQuote {
  return {
    target,
    listPrice: chargedPrice,
    chargedPrice,
    discountAmount: 0,
    discountPercent: 0,
    discountKind: null,
    campaignId: null,
    campaignName: null,
    campaignVersion: null,
    campaignEndsAt: null,
    freePerUserLimit: null,
  };
}

/** 未加入の会員。単発チケットは定価（299円）で買える。 */
function quota(overrides: Partial<UserQuota> = {}): UserQuota {
  return {
    freeEventCount: 0,
    freeLimit: 2,
    remainingFree: 2,
    paidCredits: 0,
    subscriptionStatus: "NONE",
    subscriptionPlan: "NONE",
    currentPeriodEnd: null,
    canCreate: true,
    planType: "FREE_TRIAL",
    phoneVerified: true,
    pricing: {
      oneTime: quote("ONE_TIME", 299),
      subscription8: quote("SUBSCRIPTION_8", 980),
      subscriptionUnlimited: quote("SUBSCRIPTION_UNLIMITED", 2980),
    },
    freeGrantRemaining: 0,
    ...overrides,
  };
}

function renderBanner(value: UserQuota) {
  const onPurchaseTicket = vi.fn(async () => "REDIRECT" as const);
  const utils = render(
    <QuotaStatusBanner quota={value} onPurchaseTicket={onPurchaseTicket} />,
  );
  return { ...utils, onPurchaseTicket };
}

afterEach(() => {
  cleanup();
});

describe("月額プランの導線", () => {
  it("未加入の帯は、月額プランを見るを /organizer/plan へのリンクとして出す", () => {
    renderBanner(quota());

    const link = screen.getByRole("link", { name: "月額プランを見る" });

    expect(link.getAttribute("href")).toBe("/organizer/plan");
  });

  it("公開し放題プランに加入中は、月額プランを見るを出さない", () => {
    renderBanner(
      quota({ subscriptionStatus: "ACTIVE", subscriptionPlan: "UNLIMITED" }),
    );

    expect(screen.queryByRole("link", { name: "月額プランを見る" })).toBeNull();
  });
});

describe("単発チケットの導線", () => {
  it("未加入の帯は、単発チケットを買うを押すと単発チケットの層を開く", async () => {
    const user = userEvent.setup();
    const { onPurchaseTicket } = renderBanner(quota());

    await user.click(screen.getByRole("button", { name: "単発チケットを買う" }));

    const dialog = screen.getByRole("dialog");
    expect(dialog).toBeTruthy();
    expect(
      screen.getByRole("heading", { name: "単発チケット" }),
    ).toBeTruthy();
    // 開いただけでは購入しない。押すのは層の中のボタン。
    expect(onPurchaseTicket).not.toHaveBeenCalled();
  });

  it("公開し放題プランに加入中は、単発チケットを買うを出さない", () => {
    renderBanner(
      quota({ subscriptionStatus: "ACTIVE", subscriptionPlan: "UNLIMITED" }),
    );

    expect(screen.queryByRole("button", { name: "単発チケットを買う" })).toBeNull();
  });

  it("支払いに問題がある間は、単発チケットを買うを出さず月額プランを見るだけを残す", () => {
    renderBanner(
      quota({ subscriptionStatus: "PAST_DUE", subscriptionPlan: "MONTHLY_8" }),
    );

    expect(screen.queryByRole("button", { name: "単発チケットを買う" })).toBeNull();
    expect(screen.getByRole("link", { name: "月額プランを見る" })).toBeTruthy();
  });

  it("0円キャンペーンで受け取れるときは、0円チケットを受け取るにする", () => {
    renderBanner(
      quota({
        freeGrantRemaining: 1,
        pricing: {
          oneTime: quote("ONE_TIME", 0),
          subscription8: quote("SUBSCRIPTION_8", 980),
          subscriptionUnlimited: quote("SUBSCRIPTION_UNLIMITED", 2980),
        },
      }),
    );

    expect(screen.getByRole("button", { name: "0円チケットを受け取る" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "単発チケットを買う" })).toBeNull();
  });
});

describe("残数の読み込み中", () => {
  it("プレースホルダを出し、月額と単発の導線は出さない", () => {
    const onPurchaseTicket = vi.fn(async () => "REDIRECT" as const);
    const { container } = render(
      <QuotaStatusBanner quota={null} loading onPurchaseTicket={onPurchaseTicket} />,
    );

    // 帯の高さを取るための枠。読み上げには待っていることを伝える。
    expect(container.querySelector('[aria-busy="true"]')).toBeTruthy();
    expect(screen.getByText("チケットの残りを読み込んでいます")).toBeTruthy();
    expect(screen.queryByRole("link", { name: "月額プランを見る" })).toBeNull();
    expect(screen.queryByRole("button", { name: "単発チケットを買う" })).toBeNull();
  });

  it("quota が届いたら、プレースホルダを本物の帯に替える", () => {
    const onPurchaseTicket = vi.fn(async () => "REDIRECT" as const);
    const { container, rerender } = render(
      <QuotaStatusBanner quota={null} loading onPurchaseTicket={onPurchaseTicket} />,
    );
    expect(container.querySelector('[aria-busy="true"]')).toBeTruthy();

    rerender(
      <QuotaStatusBanner quota={quota()} loading={false} onPurchaseTicket={onPurchaseTicket} />,
    );

    expect(container.querySelector('[aria-busy="true"]')).toBeNull();
    expect(screen.getByRole("link", { name: "月額プランを見る" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "単発チケットを買う" })).toBeTruthy();
  });

  it("読み込みが終わって quota も無いときは、何も出さない", () => {
    const onPurchaseTicket = vi.fn(async () => "REDIRECT" as const);
    const { container } = render(
      <QuotaStatusBanner quota={null} loading={false} onPurchaseTicket={onPurchaseTicket} />,
    );

    expect(container.firstChild).toBeNull();
  });
});
