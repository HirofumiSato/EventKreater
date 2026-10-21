"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { AdminChrome } from "@/modules/admin/components/AdminChrome";
import { readProblem } from "@/lib/problem";

interface AdminPaymentRow {
  id: string;
  paymentType: "ONE_TIME" | "SUBSCRIPTION";
  paymentStatus: "PENDING" | "SUCCEEDED" | "FAILED" | "REFUNDED" | "DISPUTED";
  amount: number;
  currency: string;
  stripeCheckoutSessionId: string | null;
  stripePaymentIntentId: string | null;
  stripeInvoiceId: string | null;
  createdAt: string;
  user: { id: string; name: string; email: string };
}

const PAGE_SIZE = 30;

const TYPE_LABEL = {
  ONE_TIME: "単発",
  SUBSCRIPTION: "月額",
} as const;

const STATUS_LABEL = {
  PENDING: "手続き中",
  SUCCEEDED: "支払済み",
  FAILED: "失敗",
  REFUNDED: "返金済み",
  DISPUTED: "異議申立",
} as const;

function formatWhen(value: string): string {
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

export default function AdminPaymentsPage() {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [submittedQ, setSubmittedQ] = useState("");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [payments, setPayments] = useState<AdminPaymentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [blocked, setBlocked] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (query: string, nextPage: number) => {
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({ q: query, page: String(nextPage) });
    const res = await fetch(`/api/v1/admin/payments?${params.toString()}`);
    if (res.status === 401) {
      router.replace("/console/login");
      return;
    }
    if (res.status === 403) {
      setBlocked(true);
      setPayments([]);
      setLoading(false);
      return;
    }
    if (!res.ok) {
      setError(await readProblem(res));
      setLoading(false);
      return;
    }
    const data = (await res.json()) as { payments: AdminPaymentRow[]; total: number };
    setPayments(data.payments);
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
    return <p className="empty">このページは利用できません。</p>;
  }

  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <AdminChrome>
      <div>
        <h1 className="page-title">利用枠の決済履歴</h1>
        <p className="page-lead">
          利用枠の単発購入と月額請求です。会員の名前、メール、Stripe のセッション ID・請求書 ID・PaymentIntent ID で検索します。
        </p>
      </div>
      <form className="form" onSubmit={search}>
        <div className="field">
          <label className="label" htmlFor="admin-payment-q">
            検索
          </label>
          <input
            id="admin-payment-q"
            value={q}
            onChange={(event) => setQ(event.target.value)}
            placeholder="名前、メール、Stripe ID"
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
                <th>日時</th>
                <th>会員</th>
                <th>種別</th>
                <th>状態</th>
                <th>金額</th>
                <th>Stripe</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td className="data__empty" colSpan={6}>
                    読み込んでいます
                  </td>
                </tr>
              ) : payments.length === 0 ? (
                <tr>
                  <td className="data__empty" colSpan={6}>
                    条件に合う決済はありません。
                  </td>
                </tr>
              ) : (
                payments.map((payment) => (
                  <tr key={payment.id}>
                    <td className="data__muted">{formatWhen(payment.createdAt)}</td>
                    <td>
                      {payment.user.name}
                      <div className="data__muted">{payment.user.email}</div>
                    </td>
                    <td>{TYPE_LABEL[payment.paymentType]}</td>
                    <td>{STATUS_LABEL[payment.paymentStatus]}</td>
                    <td>
                      {payment.amount.toLocaleString("ja-JP")} {payment.currency.toUpperCase()}
                    </td>
                    <td className="data__muted">
                      {payment.stripeInvoiceId ? <div>{payment.stripeInvoiceId}</div> : null}
                      {payment.stripeCheckoutSessionId ? <div>{payment.stripeCheckoutSessionId}</div> : null}
                      {payment.stripePaymentIntentId ? <div>{payment.stripePaymentIntentId}</div> : null}
                    </td>
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
