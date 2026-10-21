"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { AdminChrome } from "@/modules/admin/components/AdminChrome";
import { readProblem } from "@/lib/problem";

interface AdminUserRow {
  id: string;
  email: string;
  name: string;
  platformRole: "MEMBER" | "ADMIN";
  hasPassword: boolean;
  withdrawn: boolean;
  deletedAt: string | null;
  phoneMasked: string | null;
  phoneVerified: boolean;
  createdAt: string;
  organizerCount: number;
  participantCount: number;
}

const PAGE_SIZE = 30;

function formatWhen(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("ja-JP", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export default function AdminUsersPage() {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [submittedQ, setSubmittedQ] = useState("");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [actorId, setActorId] = useState<string | null>(null);
  const [users, setUsers] = useState<AdminUserRow[]>([]);
  const [drafts, setDrafts] = useState<Record<string, "MEMBER" | "ADMIN">>({});
  const [loading, setLoading] = useState(true);
  const [blocked, setBlocked] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async (query: string, nextPage: number) => {
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({ q: query, page: String(nextPage) });
    const res = await fetch(`/api/v1/admin/users?${params.toString()}`);
    if (res.status === 401) {
      router.replace("/console/login");
      return;
    }
    if (res.status === 403) {
      setBlocked(true);
      setUsers([]);
      setLoading(false);
      return;
    }
    if (!res.ok) {
      setError(await readProblem(res));
      setLoading(false);
      return;
    }
    const data = (await res.json()) as { users: AdminUserRow[]; total: number; actorId: string };
    setUsers(data.users);
    setTotal(data.total);
    setActorId(data.actorId);
    setDrafts(Object.fromEntries(data.users.map((user) => [user.id, user.platformRole])));
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

  const changeRole = async (user: AdminUserRow) => {
    const nextRole = drafts[user.id] ?? user.platformRole;
    if (nextRole === user.platformRole) return;
    setBusyId(user.id);
    setError(null);
    try {
      const res = await fetch(`/api/v1/admin/users/${user.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ platformRole: nextRole }),
      });
      if (!res.ok) throw new Error(await readProblem(res));
      setUsers((current) => current.map((row) => (row.id === user.id ? { ...row, platformRole: nextRole } : row)));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "権限を変更できませんでした");
      setDrafts((current) => ({ ...current, [user.id]: user.platformRole }));
    } finally {
      setBusyId(null);
    }
  };

  if (blocked) {
    return <p className="empty">このページは利用できません。</p>;
  }

  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <AdminChrome>
      <div>
        <h1 className="page-title">会員検索・権限変更</h1>
        <p className="page-lead">名前またはメールアドレスで検索し、他の会員の管理者権限を変更できます。</p>
      </div>
      <form className="form" onSubmit={search}>
        <div className="field">
          <label className="label" htmlFor="admin-user-q">
            検索
          </label>
          <input
            id="admin-user-q"
            value={q}
            onChange={(event) => setQ(event.target.value)}
            placeholder="名前、メールアドレス"
            className="input"
          />
        </div>
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
      {error ? <p className="alert alert--error">{error}</p> : null}
      <p className="help">
        {submittedQ ? `「${submittedQ}」` : "全件"} {total}件
      </p>
      <div className="table-card">
        <div className="table-card__scroll">
          <table className="data">
            <thead>
              <tr>
                <th>名前</th>
                <th>連絡先</th>
                <th>権限</th>
                <th>登録日</th>
                <th>幹事</th>
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
              ) : users.length === 0 ? (
                <tr>
                  <td className="data__empty" colSpan={6}>
                    条件に合う会員はいません。
                  </td>
                </tr>
              ) : (
                users.map((user) => {
                  const mine = user.id === actorId;
                  const draft = drafts[user.id] ?? user.platformRole;
                  return (
                    <tr key={user.id}>
                      <td>
                        {user.name}
                        {user.withdrawn ? <span className="badge badge--neutral badge--sm">退会済み</span> : null}
                        {mine ? <span className="data__muted"> （自分）</span> : null}
                      </td>
                      <td>
                        {user.email}
                        {user.phoneMasked ? (
                          <div className="data__muted">
                            電話 {user.phoneMasked}
                            {user.phoneVerified ? "" : "（未確認）"}
                          </div>
                        ) : null}
                        {!user.hasPassword ? <div className="data__muted">パスワードなし</div> : null}
                        {user.withdrawn && user.deletedAt ? (
                          <div className="data__muted">退会 {formatWhen(user.deletedAt)}</div>
                        ) : null}
                      </td>
                      <td>
                        <div className="btn-row">
                          <select
                            className="input input--compact"
                            aria-label={`${user.name}の権限`}
                            value={draft}
                            disabled={mine || user.withdrawn || busyId === user.id}
                            onChange={(event) =>
                              setDrafts((current) => ({
                                ...current,
                                [user.id]: event.target.value as "MEMBER" | "ADMIN",
                              }))
                            }
                          >
                            <option value="MEMBER">会員</option>
                            <option value="ADMIN">管理者</option>
                          </select>
                          <button
                            type="button"
                            className="btn btn--outline btn--sm"
                            disabled={
                              mine || user.withdrawn || busyId === user.id || draft === user.platformRole
                            }
                            onClick={() => void changeRole(user)}
                          >
                            保存
                          </button>
                        </div>
                      </td>
                      <td className="data__muted">{formatWhen(user.createdAt)}</td>
                      <td>{user.organizerCount}</td>
                      <td>{user.participantCount}</td>
                    </tr>
                  );
                })
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
