/**
 * 未読数の見た目。札（頭文字）のバッジとメニューが出す文字列。
 *
 * 共通ヘッダーはクライアントで描くので、この関数は `node:crypto` を使う
 * `rsvp-notification.ts` から切り離してある（ハッシュはサーバーだけで使う）。
 * `rsvp-notification.ts` からも再輸出するので、呼ぶ側は 1 か所を覚えればよい。
 */

/**
 * 0 件は空文字（要素ごと出さない）、1〜9 はそのまま、10 以上は `9+`。
 * 桁で幅が変わると、390px のヘッダーで札が押し出されて横スクロールになる。
 */
export function formatUnreadCount(count: number): string {
  if (!Number.isFinite(count) || count <= 0) return "";
  const value = Math.floor(count);
  if (value <= 0) return "";
  if (value <= 9) return String(value);
  return "9+";
}
