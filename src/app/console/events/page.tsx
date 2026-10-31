"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AdminChrome } from "@/modules/admin/components/AdminChrome";
import { readProblem } from "@/lib/problem";
import { Alert, EmptyState, Field } from "@/components/ui";

interface AdminEventRow {
  id: string;
  title: string;
  location: string;
  status: "DRAFT" | "PUBLISHED" | "CLOSED";
  isDeleted: boolean;
  sortDate: string;
  createdAt: string;
  participantCount: number;
  organizerCount: number;
  coHostCount: number;
  coHostNames: string[];
  owner: { id: string | null; name: string; email: string | null; isGuest: boolean } | null;
  publicPath: string | null;
}

const PAGE_SIZE = 30;

const STATUS_LABEL = {
  DRAFT: "下書き",
  PUBLISHED: "公開中",
  CLOSED: "受付停止",
} as const;


export default function AdminEventsPage() {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [submittedQ, setSubmittedQ] = useState("");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [events, setEvents] = useState<AdminEventRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [blocked, setBlocked] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (query: string, nextPage: number) => {
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({ q: query, page: String(nextPage) });
    const res = await fetch(`/api/v1/admin/events?${params.toString()}`);
    if (res.status === 401) {
      router.replace("/console/login");
      return;
    }
    if (res.status === 403) {
      setBlocked(true);
      setEvents([]);
      setLoading(false);
      return;
    }
    if (!res.ok) {
      setError(await readProblem(res));
      setLoading(false);
      return;
    }
    const data = (await res.json()) as { events: AdminEventRow[]; total: number };
    setEvents(data.events);
    setTotal(data.total);
    setBlocked(false);
    setLoading(false);
  }, [router]);

  useEffect(() => {
    void load("", 1);
  }, [load]);

  const search = (event: FormEvent) => {
    event.preventDefault();
    const next = q.trim();
    setSubmittedQ(next);
    setPage(1);
    void load(next, 1);
  };

  if (blocked) {
    return <EmptyState>このページは利用できません。</EmptyState>;
  }

  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <AdminChrome>
      <div>
        <h1 className="page-title">イベント検索</h1>
        <p className="page-lead">イベント名、場所、幹事の名前またはメールアドレスで検索します。下書きと削除済みも含みます。</p>
      </div>
      <form className="form" onSubmit={search}>
        <Field label="検索" htmlFor="admin-event-q">
          <input
            id="admin-event-q"
            value={q}
            onChange={(event) => setQ(event.target.value)}
            placeholder="イベント名、場所、幹事"
            className="input"
          />
        </Field>
        <div className="btn-row">
          <button type="submit" className="btn btn--primary">
            検索
          </button>
          <button
            type="button"
            className="btn btn--outline"
            onClick={() => {
              setQ("");
              setSubmittedQ("");
              setPage(1);
              void load("", 1);
            }}
          >
            条件をクリア
          </button>
        </div>
      </form>
      {error ? <Alert tone="error">{error}</Alert> : null}
      <p className="help">
        {submittedQ ? `「${submittedQ}」` : "全件"} {total}件
      </p>
      <div className="table-card">
        <div className="table-card__scroll">
          <table className="data">
            <thead>
              <tr>
                <th>イベント名</th>
                <th>場所</th>
                <th>状態</th>
                <th>開催日</th>
                <th>主催者</th>
                <th>出欠</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td className="data__empty" colSpan={6}>
                    読み込んでいます
                  </td>
                </tr>
              ) : events.length === 0 ? (
                <tr>
                  <td className="data__empty" colSpan={6}>
                    条件に合うイベントはありません。
                  </td>
                </tr>
              ) : (
                events.map((event) => (
                  <tr key={event.id}>
                    <td>
                      {event.publicPath ? (
                        <Link href={event.publicPath} target="_blank" rel="noopener noreferrer">
                          {event.title}
                        </Link>
                      ) : (
                        event.title
                      )}
                      {event.isDeleted ? <div className="data__muted">削除済み</div> : null}
                    </td>
                    <td>{event.location}</td>
                    <td>{STATUS_LABEL[event.status]}</td>
                    <td className="data__muted">{event.sortDate}</td>
                    <td>
                      {event.owner ? (
                        <>
                          {event.owner.name}
                          {event.owner.email ? (
                            <div className="data__muted">{event.owner.email}</div>
                          ) : (
                            <div className="data__muted">未登録の幹事</div>
                          )}
                          {event.coHostCount > 0 ? (
                            <div className="data__muted">
                              共同主催 {event.coHostCount}名
                              {event.coHostNames.length > 0 ? `（${event.coHostNames.join("、")}）` : ""}
                            </div>
                          ) : null}
                        </>
                      ) : (
                        <span className="data__muted">幹事なし</span>
                      )}
                    </td>
                    <td>{event.participantCount}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
      {pageCount > 1 ? (
        <div className="btn-row">
          <button
            type="button"
            className="btn btn--outline btn--sm"
            disabled={page <= 1 || loading}
            onClick={() => {
              const next = page - 1;
              setPage(next);
              void load(submittedQ, next);
            }}
          >
            前へ
          </button>
          <span className="help">
            {page} / {pageCount}
          </span>
          <button
            type="button"
            className="btn btn--outline btn--sm"
            disabled={page >= pageCount || loading}
            onClick={() => {
              const next = page + 1;
              setPage(next);
              void load(submittedQ, next);
            }}
          >
            次へ
          </button>
        </div>
      ) : null}
    </AdminChrome>
  );
}
