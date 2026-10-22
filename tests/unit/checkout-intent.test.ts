import { describe, expect, it } from "vitest";
import { CheckoutIntentSchema } from "@/lib/schemas";
import {
  checkoutReturnUrls,
  isAllowedCheckoutReturnTo,
  normalizeCheckoutReturnTo,
} from "@/modules/billing/lib/checkout-return";

const DRAFT_ID = "11111111-1111-4111-8111-111111111111";

/**
 * `returnTo` は Stripe の success_url にそのまま載る。
 * 外部 URL や想定外のパスを受け付けると、購入後にどこへでも飛ばせてしまう。
 */
describe("Checkout の戻り先", () => {
  it("購入を開ける画面だけを許可する", () => {
    expect(isAllowedCheckoutReturnTo("/organizer/events/new")).toBe(true);
    expect(isAllowedCheckoutReturnTo("/organizer/events")).toBe(true);
    expect(isAllowedCheckoutReturnTo("/mypage")).toBe(true);
    expect(isAllowedCheckoutReturnTo(`/organizer/events/${DRAFT_ID}/edit`)).toBe(true);
    expect(isAllowedCheckoutReturnTo(`/organizer/events/new?ref=${DRAFT_ID}`)).toBe(true);
  });

  it("外部 URL・別パス・余計なクエリを拒否する", () => {
    expect(isAllowedCheckoutReturnTo("/")).toBe(false);
    expect(isAllowedCheckoutReturnTo("https://evil.example/mypage")).toBe(false);
    expect(isAllowedCheckoutReturnTo("//evil.example/mypage")).toBe(false);
    expect(isAllowedCheckoutReturnTo("/organizer/events/new?x=1")).toBe(false);
    expect(isAllowedCheckoutReturnTo(`/organizer/events/${DRAFT_ID}`)).toBe(false);
    expect(isAllowedCheckoutReturnTo(`/organizer/events/${DRAFT_ID}/edit?x=1`)).toBe(false);
    expect(isAllowedCheckoutReturnTo("/organizer/revenue")).toBe(false);
  });

  it("未指定・不正な値は作成画面へ戻す", () => {
    expect(normalizeCheckoutReturnTo(null)).toBe("/organizer/events/new");
    expect(normalizeCheckoutReturnTo("https://evil.example")).toBe("/organizer/events/new");
    expect(normalizeCheckoutReturnTo("/mypage")).toBe("/mypage");
  });

  it("session_id のプレースホルダをエンコードせず、下書き ID を添える", () => {
    expect(checkoutReturnUrls("http://localhost:3012", "/organizer/events/new", DRAFT_ID)).toEqual({
      successUrl: `http://localhost:3012/organizer/events/new?session_id={CHECKOUT_SESSION_ID}&draftId=${DRAFT_ID}`,
      cancelUrl: `http://localhost:3012/organizer/events/new?draftId=${DRAFT_ID}`,
    });
  });

  it("参照元のクエリがあるときは & で繋ぐ", () => {
    const { successUrl, cancelUrl } = checkoutReturnUrls(
      "http://localhost:3012",
      `/organizer/events/new?ref=${DRAFT_ID}`,
    );
    expect(successUrl).toBe(
      `http://localhost:3012/organizer/events/new?ref=${DRAFT_ID}&session_id={CHECKOUT_SESSION_ID}`,
    );
    expect(cancelUrl).toBe(`http://localhost:3012/organizer/events/new?ref=${DRAFT_ID}`);
  });
});

describe("CheckoutIntentSchema", () => {
  it("空でも通り、下書き ID は UUID を要求する", () => {
    expect(CheckoutIntentSchema.safeParse({}).success).toBe(true);
    expect(CheckoutIntentSchema.safeParse({ draftId: DRAFT_ID }).success).toBe(true);
    expect(CheckoutIntentSchema.safeParse({ draftId: "not-a-uuid" }).success).toBe(false);
  });

  it("許可していない戻り先は 400 にする", () => {
    expect(CheckoutIntentSchema.safeParse({ returnTo: "/mypage" }).success).toBe(true);
    expect(CheckoutIntentSchema.safeParse({ returnTo: "/console" }).success).toBe(false);
    expect(CheckoutIntentSchema.safeParse({ returnTo: "https://evil.example" }).success).toBe(false);
  });
});
