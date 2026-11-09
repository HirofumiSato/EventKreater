/**
 * ヘッダーのユーザーメニュー（`#site-user-menu`）を、外から開閉するための細い口。
 *
 * メニューの開閉は `Navbar` のローカルな状態が持っている。操作ガイドは「通知」リンクを
 * 指すために、そのメニューを開いた状態にする必要がある。しかし `Navbar` とガイドは
 * 別の木にあり（`SiteChrome` の下と、画面の本文の下）、props を引き回すと
 * `SiteChrome` がガイドのために状態と受け渡しを持つことになる。
 *
 * そこで、開閉の合図だけを `window` のイベントで 1 方向に流す。`Navbar` は購読して
 * 自分の状態を合わせ、ガイドは `setSiteUserMenuOpen()` を呼ぶだけにする。
 * イベントは「開いてほしい／閉じてほしい」を伝えるだけで、DOM は触らない。
 */

/** メニューの開閉を伝えるイベント名。 */
export const SITE_USER_MENU_EVENT = "eventkreater:site-user-menu";

/** イベントに載せる中身。`open` が真ならメニューを開く。 */
export type SiteUserMenuDetail = { open: boolean };

/**
 * ヘッダーのユーザーメニューを開閉する。
 * サーバー側（`window` が無い）では何もしない。呼び出し側は描画後に呼ぶ。
 */
export function setSiteUserMenuOpen(open: boolean): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<SiteUserMenuDetail>(SITE_USER_MENU_EVENT, {
      detail: { open },
    }),
  );
}
