"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { NotificationRows } from "@/modules/notifications/components/NotificationRows";
import { announceNotificationsChanged } from "@/modules/notifications/hooks/useNotifications";
import type { NotificationsResponse, RsvpNotification } from "@/modules/notifications/types";
import { readProblem } from "@/lib/problem";
import { loginUrl } from "@/lib/auth-links";
import { Alert, EmptyState, Loading, PageHeader } from "@/components/ui";

/** 1 回に取る件数。API の `limit` の上限（50）に合わせる。 */
const LIST_LIMIT = 50;

/**
 * 通知一覧（SCR-PUB-15）。
 *
 * 主催者マイページの「新着」は 4 件までにし、続きはこの画面が受ける。
 * 行の形と既読の送り方は `NotificationRows` に任せ、ここは並べる数だけを変える。
 *
 * 100 件を超えると古い通知は辿れない。行き先は「新しい 50 件まで」であることを
 * 本文に書き、ページ送りは持たない（まだ要るほどの件数になっていない）。
 */
export default function NotificationsPage() {
  const [notifications, setNotifications] = useState<RsvpNotification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [marking, setMarking] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const load = async () => {
      const res = await fetch(`/api/v1/notifications?limit=${LIST_LIMIT}`, { cache: "no-store" });
      if (res.status === 401) {
        if (active) setError("ログインが必要です。");
        return;
      }
      if (!res.ok) {
        if (active) setError(await readProblem(res));
        return;
      }
      const body = (await res.json()) as NotificationsResponse;
      if (!active) return;
      setNotifications(body.notifications);
      setUnreadCount(body.unreadCount);
    };
    void load()
      .catch((cause: unknown) => {
        if (active) setError(cause instanceof Error ? cause.message : "読み込みに失敗しました");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  /** 既読の送信。応答の未読数をそのまま反映し、ヘッダーのバッジにも知らせる。 */
  const markRead = async (ids?: string[]) => {
    if (marking) return;
    setMarking(true);
    const readAt = new Date().toISOString();
    try {
      const res = await fetch("/api/v1/notifications", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(ids && ids.length > 0 ? { ids } : { all: true }),
      });
      if (!res.ok) return;
      const body = (await res.json()) as { unreadCount: number };
      setUnreadCount(body.unreadCount);
      // 楽観的にはせず、送れた分だけ既読にする（失敗したら未読のまま残す）。
      const target = ids && ids.length > 0 ? new Set(ids) : null;
      setNotifications((current) =>
        current.map((row) =>
          !target || target.has(row.id) ? { ...row, readAt: row.readAt ?? readAt } : row,
        ),
      );
      announceNotificationsChanged();
    } catch {
      // 既読にできなかっただけ。未読のまま残し、次の読み込みで取り直す。
    } finally {
      setMarking(false);
    }
  };

  /** 行を押したとき。名簿へ移る前に、その 1 件だけ既読にする。 */
  const openNotification = (notification: RsvpNotification) => {
    if (notification.readAt !== null) return;
    void markRead([notification.id]);
  };

  const readNote =
    unreadCount > 0 ? `未読 ${unreadCount}件。新しい順に表示。` : "新しい順に表示。";

  return (
    <div className="stack">
      <PageHeader
        title="通知"
        lead={readNote}
        actions={
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={() => void markRead()}
            disabled={marking || unreadCount === 0}
          >
            すべて既読にする
          </button>
        }
      />

      {loading && <Loading>通知を読み込んでいます</Loading>}

      {!loading && error && (
        <Alert tone="warning">
          {error}{" "}
          <Link href={loginUrl("/notifications")} className="text-link">
            主催者ログイン
          </Link>
        </Alert>
      )}

      {!loading && !error && notifications.length === 0 && (
        <EmptyState>
          まだありません。参加者が答えると、ここに出ます。
        </EmptyState>
      )}

      {!loading && !error && notifications.length > 0 && (
        <>
          <NotificationRows
            notifications={notifications}
            marking={marking}
            onMarkOne={(notification) => void markRead([notification.id])}
            onOpen={openNotification}
          />
          {notifications.length >= LIST_LIMIT ? (
            <p className="screen-note">新しい {LIST_LIMIT} 件まで表示しています。</p>
          ) : null}
        </>
      )}
    </div>
  );
}
