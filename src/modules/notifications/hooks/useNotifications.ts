"use client";

import { useCallback, useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import type { NotificationsResponse } from "@/modules/notifications/types";

/**
 * 未読数を取るフック。共通ヘッダーの札（頭文字）に出すバッジだけが使う。
 *
 * 通知は主催者にしか作られないので、主催者でない会員は呼ばない（`enabled`）。
 * 取り直す契機は 4 つ。
 * - 画面を移ったとき（主催一覧 → 名簿 など、見ている場所が変われば数も変わり得る）
 * - タブへ戻ったとき（別の端末で答えた出欠を拾う）
 * - 60 秒ごと（開きっぱなしの画面でも、そのうち気づける）
 * - `notifications:changed`（既読にした直後に、その場でバッジを消す）
 *
 * 数を合わせるのは `PATCH /api/v1/notifications` の応答とこのイベントだけで、
 * 画面ごとに未読数を計算し直さない。
 */

/** 既読にしたことを同じタブのヘッダーへ知らせるイベント名。 */
export const NOTIFICATIONS_CHANGED = "notifications:changed";

/** 未読数を取り直す間隔。開きっぱなしでも 1 分で追いつく。 */
const POLL_INTERVAL_MS = 60_000;

export interface UnreadNotificationsState {
  unreadCount: number;
  /** 手で取り直す。既読にした直後に呼ぶ。 */
  refresh: () => Promise<void>;
  /** 取り直した結果で数える。既読 API の応答をそのまま反映する。 */
  setUnreadCount: (count: number) => void;
}

/** どこかで既読にしたことを、開いているヘッダーへ知らせる。 */
export function announceNotificationsChanged(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(NOTIFICATIONS_CHANGED));
}

export function useUnreadNotifications(enabled: boolean): UnreadNotificationsState {
  const pathname = usePathname();
  const [unreadCount, setUnreadCount] = useState(0);

  const refresh = useCallback(async () => {
    if (!enabled) return;
    try {
      const res = await fetch("/api/v1/notifications?limit=1");
      if (!res.ok) return;
      const data = (await res.json()) as Pick<NotificationsResponse, "unreadCount">;
      setUnreadCount(typeof data.unreadCount === "number" ? data.unreadCount : 0);
    } catch {
      // 数が取れないだけ。バッジを出さないまま次の契機で取り直す。
    }
  }, [enabled]);

  useEffect(() => {
    void refresh();
  }, [refresh, pathname]);

  useEffect(() => {
    if (!enabled) return;
    const timer = window.setInterval(() => void refresh(), POLL_INTERVAL_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    const onChanged = () => void refresh();
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener(NOTIFICATIONS_CHANGED, onChanged);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener(NOTIFICATIONS_CHANGED, onChanged);
    };
  }, [enabled, refresh]);

  return { unreadCount, refresh, setUnreadCount };
}
