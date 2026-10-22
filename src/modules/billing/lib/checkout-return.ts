import { SITE } from "@/lib/site";

/** 購入後に戻る既定の画面。作成画面の入力を復元する起点でもある。 */
export const DEFAULT_CHECKOUT_RETURN_TO = SITE.nav.createEvent.href;

const UUID_PATTERN = "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}";

/**
 * Checkout の戻り先として許可するパス。
 * Stripe の `success_url` にそのまま載せるため、外部 URL や未知のパスは受け付けない。
 */
const RETURN_TO_PATTERN = new RegExp(
  `^/(?:mypage|organizer/events|organizer/events/new(?:\\?ref=${UUID_PATTERN})?|organizer/events/${UUID_PATTERN}/edit)$`,
);

export function isAllowedCheckoutReturnTo(value: string): boolean {
  return RETURN_TO_PATTERN.test(value);
}

export function normalizeCheckoutReturnTo(value: string | null | undefined): string {
  return value && isAllowedCheckoutReturnTo(value) ? value : DEFAULT_CHECKOUT_RETURN_TO;
}

/**
 * Stripe の success / cancel URL を組み立てる。
 * `{CHECKOUT_SESSION_ID}` は Stripe が置き換えるリテラルなので、URL エンコードしない。
 */
export function checkoutReturnUrls(appUrl: string, returnTo: string, draftId?: string) {
  const base = `${appUrl}${returnTo}`;
  const separator = base.includes("?") ? "&" : "?";
  return {
    successUrl: draftId
      ? `${base}${separator}session_id={CHECKOUT_SESSION_ID}&draftId=${draftId}`
      : `${base}${separator}session_id={CHECKOUT_SESSION_ID}`,
    cancelUrl: draftId ? `${base}${separator}draftId=${draftId}` : base,
  };
}
