"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { readProblem } from "@/lib/problem";
import { rsvpStatusTone } from "@/modules/events/lib/rsvp-status";
import type { ParticipationListResponse } from "@/modules/participants/types";

interface ProfileResponse {
  user: { id: string; email: string; name: string };
  isOrganizer: boolean;
}

export default function ParticipantHomePage() {
  const [profile, setProfile] = useState<ProfileResponse | null>(null);
  const [upcoming, setUpcoming] = useState<ParticipationListResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void (async () => {
      const profileRes = await fetch("/api/v1/user/profile");
      if (profileRes.status === 401) {
        if (active) setError("ログインが必要です。");
        return;
      }
      if (!profileRes.ok) {
        if (active) setError(await readProblem(profileRes));
        return;
      }
      const profileBody = (await profileRes.json()) as ProfileResponse;
      const listRes = await fetch("/api/v1/user/participations?scope=upcoming&limit=3");
      const listBody = listRes.ok ? ((await listRes.json()) as ParticipationListResponse) : null;
      if (!active) return;
      setProfile(profileBody);
      setUpcoming(listBody);
      await fetch("/api/v1/user/hydrate", { method: "POST" });
    })().catch((cause: unknown) => {
      if (active) setError(cause instanceof Error ? cause.message : "読み込みに失敗しました");
    });
    return () => {
      active = false;
    };
  }, []);

  const logout = async () => {
    await fetch("/api/v1/auth/logout", { method: "POST" });
    window.location.href = "/";
  };

  if (error) {
    return (
      <div className="page--narrow stack">
        <p className="alert alert--warning">
          {error}{" "}
          <Link href="/participant/login" className="text-link">
            参加者ログイン
          </Link>
        </p>
      </div>
    );
  }
  if (!profile) {
    return (
      <p className="loading">
        <span className="spinner" aria-hidden="true" />
        参加者ホームを読み込んでいます
      </p>
    );
  }

  const summary = upcoming?.summary;

  return (
    <div className="stack">
      <section className="panel">
        <div>
          <h1 className="page-title">{profile.user.name} さんの参加者ホーム</h1>
          <p className="page-lead">{profile.user.email} ・ 出欠の履歴と領収書を確認できます。</p>
        </div>
        <div className="panel__actions">
          <button type="button" onClick={() => void logout()} className="btn btn--ghost">
            ログアウト
          </button>
        </div>
      </section>

      <section className="stat-grid">
        <article className="stat">
          <p className="stat__label">これからの参加</p>
          <p className="stat__value">{summary ? `${summary.upcoming} 件` : "-"}</p>
        </article>
        <article className="stat">
          <p className="stat__label">出席と回答したイベント</p>
          <p className="stat__value">{summary ? `${summary.attending} 件` : "-"}</p>
        </article>
        <article className="stat">
          <p className="stat__label">参加要望を出しているイベント</p>
          <p className="stat__value">{summary ? `${summary.waitlisted} 件` : "-"}</p>
        </article>
        <article className="stat">
          <p className="stat__label">欠席と回答したイベント</p>
          <p className="stat__value">{summary ? `${summary.declined} 件` : "-"}</p>
        </article>
      </section>

      <section className="stack">
        <div className="panel">
          <h2 className="panel__title">次に参加するイベント</h2>
          <div>
            <Link href="/participant/history" className="btn btn--outline btn--sm">
              参加履歴をすべて見る
            </Link>
          </div>
        </div>
        {!upcoming || upcoming.items.length === 0 ? (
          <p className="empty">これから参加するイベントはありません。</p>
        ) : (
          upcoming.items.map((row) => (
            <article key={row.id} className="card">
              <div className="btn-row">
                <Link href={`/events/${row.event.id}`} className="card__title">
                  {row.event.title}
                </Link>
                <span className={`badge badge--sm badge--${rsvpStatusTone(row.status)}`}>
                  {row.statusLabel}
                </span>
              </div>
              <p className="card__body">
                {row.scheduleLabel ?? row.event.sortDate}
                {row.pricePlanLabel ? ` ・ ${row.pricePlanLabel}` : ""}
                {` ・ ${row.event.location}`}
              </p>
              {row.comment && <p className="card__body">コメント: {row.comment}</p>}
              <div className="card__actions">
                <Link href={`/events/${row.event.id}`} className="btn btn--outline btn--sm">
                  出欠を変更する
                </Link>
                {row.receiptId && (
                  <Link href={`/events/${row.event.id}/receipt`} className="btn btn--ghost btn--sm">
                    領収書を見る
                  </Link>
                )}
                {row.event.ownerUserId && (
                  <Link
                    href={`/organizers/${row.event.ownerUserId}`}
                    className="btn btn--ghost btn--sm"
                  >
                    主催者のページ
                  </Link>
                )}
              </div>
            </article>
          ))
        )}
      </section>

      <p className="help">
        参加するだけならログインは要りません。履歴を残したいときだけ、この画面のアカウントでログインしてください。
      </p>
    </div>
  );
}
