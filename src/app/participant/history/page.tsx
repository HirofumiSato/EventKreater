"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { readProblem } from "@/lib/problem";
import { rsvpStatusTone } from "@/modules/events/lib/rsvp-status";
import type { ParticipationItem, ParticipationListResponse } from "@/modules/participants/types";

type StatusFilter = "all" | "ATTENDING" | "WAITLISTED" | "DECLINED";
type ScopeFilter = "all" | "upcoming" | "past";

const PAGE_SIZE = 10;

const STATUS_OPTIONS: { value: StatusFilter; label: string }[] = [
  { value: "all", label: "すべて" },
  { value: "ATTENDING", label: "出席" },
  { value: "WAITLISTED", label: "参加要望" },
  { value: "DECLINED", label: "欠席" },
];

const SCOPE_OPTIONS: { value: ScopeFilter; label: string }[] = [
  { value: "all", label: "すべて" },
  { value: "upcoming", label: "これから" },
  { value: "past", label: "過去" },
];

function answeredLabel(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function HistoryRow({ row }: { row: ParticipationItem }) {
  return (
    <li className="rows__item">
      <div className="rows__main">
        <p className="rows__title">
          <Link href={`/events/${row.event.id}`}>{row.event.title}</Link>
        </p>
        <p className="rows__meta">
          {row.scheduleLabel ?? row.event.sortDate}
          {row.pricePlanLabel ? ` ／ ${row.pricePlanLabel}` : ""}
          {` ／ ${row.event.location}`}
        </p>
        {row.comment && <p className="rows__meta">コメント: {row.comment}</p>}
        <p className="rows__meta">回答日: {answeredLabel(row.answeredAt)}</p>
      </div>
      {row.receiptId ? (
        <Link href={`/events/${row.event.id}/receipt`} className="btn btn--ghost btn--sm">
          領収書
        </Link>
      ) : (
        <span className={`badge badge--sm badge--${rsvpStatusTone(row.status)}`}>{row.statusLabel}</span>
      )}
    </li>
  );
}

export default function ParticipantHistoryPage() {
  const [status, setStatus] = useState<StatusFilter>("all");
  const [scope, setScope] = useState<ScopeFilter>("all");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<ParticipationListResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({ scope, page: String(page), limit: String(PAGE_SIZE) });
    if (status !== "all") params.set("status", status);
    const res = await fetch(`/api/v1/user/participations?${params.toString()}`);
    if (res.status === 401) {
      setError("ログインが必要です。");
      setData(null);
      return;
    }
    if (!res.ok) {
      setError(await readProblem(res));
      setData(null);
      return;
    }
    setData((await res.json()) as ParticipationListResponse);
    setError(null);
  }, [page, scope, status]);

  useEffect(() => {
    void load()
      .catch((cause: unknown) => {
        setError(cause instanceof Error ? cause.message : "読み込みに失敗しました");
      })
      .finally(() => setLoading(false));
  }, [load]);

  const changeStatus = (next: StatusFilter) => {
    setStatus(next);
    setPage(1);
  };

  const changeScope = (next: ScopeFilter) => {
    setScope(next);
    setPage(1);
  };

  const summary = data?.summary;
  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.limit)) : 1;

  return (
    <div className="stack">
      <div>
        <p className="eyebrow">参加者</p>
        <h1 className="page-title">参加履歴</h1>
        <p className="page-lead">答えた出欠と、受け取った領収書の一覧です。</p>
        <div className="panel__actions">
          <Link href="/participant" className="btn btn--outline btn--sm">
            参加者ホームへ
          </Link>
        </div>
      </div>

      {summary && (
        <div className="roster-summary">
          <div className="roster-summary__item">
            <span className="roster-summary__label">これから</span>
            <span className="roster-summary__value">
              {summary.upcoming}
              <span>件</span>
            </span>
          </div>
          <div className="roster-summary__item">
            <span className="roster-summary__label">出席</span>
            <span className="roster-summary__value">
              {summary.attending}
              <span>件</span>
            </span>
          </div>
          <div className="roster-summary__item">
            <span className="roster-summary__label">参加要望</span>
            <span className="roster-summary__value">
              {summary.waitlisted}
              <span>件</span>
            </span>
          </div>
          <div className="roster-summary__item">
            <span className="roster-summary__label">欠席</span>
            <span className="roster-summary__value">
              {summary.declined}
              <span>件</span>
            </span>
          </div>
        </div>
      )}

      <div className="roster-toolbar">
        <div className="segment" role="group" aria-label="出欠で絞り込む">
          {STATUS_OPTIONS.map((option) => (
            <label key={option.value} className="segment__item">
              <input
                type="radio"
                name="history-status"
                checked={status === option.value}
                onChange={() => changeStatus(option.value)}
              />
              {option.label}
            </label>
          ))}
        </div>
        <div className="segment" role="group" aria-label="時期で絞り込む">
          {SCOPE_OPTIONS.map((option) => (
            <label key={option.value} className="segment__item">
              <input
                type="radio"
                name="history-scope"
                checked={scope === option.value}
                onChange={() => changeScope(option.value)}
              />
              {option.label}
            </label>
          ))}
        </div>
      </div>

      {error && (
        <p className="alert alert--warning">
          {error}{" "}
          <Link href="/participant/login" className="text-link">
            参加者ログイン
          </Link>
        </p>
      )}

      {loading && !data && (
        <p className="loading">
          <span className="spinner" aria-hidden="true" />
          参加履歴を読み込んでいます
        </p>
      )}

      {data && data.items.length === 0 && !loading && (
        <p className="empty">
          <span className="empty__title">条件に合う参加履歴はありません。</span>
          <span className="empty__body">絞り込みを「すべて」に戻すと、答えた出欠がすべて出ます。</span>
        </p>
      )}

      {data && data.items.length > 0 && (
        <ul className="rows">
          {data.items.map((row) => (
            <HistoryRow key={row.id} row={row} />
          ))}
        </ul>
      )}

      {data && data.total > 0 && (
        <div className="panel__actions">
          <button
            type="button"
            className="btn btn--outline btn--sm"
            disabled={page <= 1 || loading}
            onClick={() => setPage((current) => Math.max(1, current - 1))}
          >
            前へ
          </button>
          <span className="help">
            {page} / {totalPages} ページ（{data.total} 件）
          </span>
          <button
            type="button"
            className="btn btn--outline btn--sm"
            disabled={!data.hasMore || loading}
            onClick={() => setPage((current) => current + 1)}
          >
            次へ
          </button>
        </div>
      )}

      <p className="screen-note">
        主催している催しは、この一覧には出しません。主催者マイページで見られます。
      </p>
    </div>
  );
}
