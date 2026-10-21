"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { OrganizerTabs } from "@/modules/organizers/components/OrganizerTabs";
import {
  isRegisterRequired,
  problemMessage,
  readProblemBody,
  sendToRegisterRequired,
} from "@/lib/problem";
import { PRICE_AUDIENCE_LABELS, STATUS_LABELS } from "@/modules/events/types";
import type {
  RevenueSummary,
  PlanRevenueRow,
  ScheduleRevenueView,
} from "@/modules/revenue/lib/revenue";

interface EventRevenueResponse {
  event: { id: string; title: string; sortDate: string; status: "DRAFT" | "PUBLISHED" | "CLOSED" };
  summary: RevenueSummary;
  byPlan: PlanRevenueRow[];
  bySchedule: ScheduleRevenueView[];
}

function yen(amount: number): string {
  return `${amount.toLocaleString("ja-JP")}円`;
}

export default function EventRevenuePage({ params }: { params: { id: string } }) {
  const [data, setData] = useState<EventRevenueResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/v1/organizer/events/${params.id}/revenue`, { cache: "no-store" });
      if (!res.ok) {
        const body = await readProblemBody(res);
        if (isRegisterRequired(body)) {
          sendToRegisterRequired(params.id);
          setError("売上の確認には会員登録が必要です。案内ページへ移動しています。");
          return;
        }
        setError(problemMessage(body, "売上の読み込みに失敗しました。"));
        return;
      }
      setData((await res.json()) as EventRevenueResponse);
      setError(null);
    } catch {
      setError("売上の読み込みに失敗しました。");
    } finally {
      setLoading(false);
    }
  }, [params.id]);

  useEffect(() => {
    void load();
  }, [load]);

  if (error) return <p className="alert alert--error">{error}</p>;
  if (loading || !data) {
    return (
      <p className="loading">
        <span className="spinner" aria-hidden="true" />
        売上を集計しています
      </p>
    );
  }

  const { event, summary, byPlan, bySchedule } = data;

  return (
    <div className="stack">
      <OrganizerTabs />

      <section className="panel">
        <div>
          <h1 className="page-title">売上の内訳</h1>
          <p className="page-lead">
            {event.title}。{event.sortDate} 開催・{STATUS_LABELS[event.status]}
          </p>
        </div>
        <div className="panel__actions">
          <Link href={`/organizer/events/${params.id}/participants`} className="btn btn--outline">
            参加者名簿へ
          </Link>
          <Link href="/organizer/revenue" className="btn btn--ghost">
            売上一覧へ
          </Link>
        </div>
      </section>

      <section className="revenue-grid">
        <article className="stat">
          <p className="stat__label">見込み売上</p>
          <p className="stat__value">{yen(summary.expectedRevenue)}</p>
          <p className="help">
            出席 {summary.attendingCount} 人中 {summary.paidAttendingCount} 人がプラン選択済み
          </p>
        </article>
        <article className="stat">
          <p className="stat__label">領収書発行額</p>
          <p className="stat__value">{yen(summary.issuedRevenue)}</p>
          <p className="help">{summary.receiptCount} 件を発行済み</p>
        </article>
        <article className="stat">
          <p className="stat__label">見込みとの差額</p>
          <p className={`stat__value${summary.unreconciled < 0 ? " stat__value--warning" : ""}`}>
            {yen(summary.unreconciled)}
          </p>
          <p className="help">未回収額ではありません。領収書と突き合わせるための差です。</p>
        </article>
        <article className="stat">
          <p className="stat__label">平均単価</p>
          <p className="stat__value">{yen(summary.averagePerAttendee)}</p>
          <p className="help">プラン選択済みの出席者1人あたり</p>
        </article>
      </section>

      {summary.unassignedPlanCount > 0 && (
        <section className="alert alert--warning">
          <p>
            出席しているのに費用プランが未選択の参加者が {summary.unassignedPlanCount} 人います。この人たちは売上に含めていません。
          </p>
          <p style={{ marginTop: "0.5rem" }}>
            <Link href={`/organizer/events/${params.id}/participants`} className="text-link">
              名簿でプランを選ぶ
            </Link>
          </p>
        </section>
      )}

      <section className="table-card">
        <div className="table-card__head">
          <h2 className="table-card__title">プラン別</h2>
          <p className="help">金額は申込時点のもの。あとから編集しても変わりません。</p>
        </div>
        <div className="table-card__scroll">
          <table className="data">
            <thead>
              <tr>
                <th scope="col">プラン</th>
                <th scope="col">対象</th>
                <th scope="col">金額</th>
                <th scope="col">人数</th>
                <th scope="col">小計</th>
              </tr>
            </thead>
            <tbody>
              {byPlan.length === 0 && (
                <tr>
                  <td colSpan={5} className="data__empty">
                    プランを選んだ出席者がまだいません。
                  </td>
                </tr>
              )}
              {byPlan.map((row) => (
                <tr key={`${row.audience}:${row.name}:${row.amount}`}>
                  <td>{row.name}</td>
                  <td className="data__muted">{PRICE_AUDIENCE_LABELS[row.audience]}</td>
                  <td>{yen(row.amount)}</td>
                  <td>{row.attendingCount} 人</td>
                  <td>{yen(row.subtotal)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="table-card">
        <div className="table-card__head">
          <h2 className="table-card__title">開催回別</h2>
        </div>
        <div className="table-card__scroll">
          <table className="data">
            <thead>
              <tr>
                <th scope="col">日時</th>
                <th scope="col">出席</th>
                <th scope="col">小計</th>
              </tr>
            </thead>
            <tbody>
              {bySchedule.length === 0 && (
                <tr>
                  <td colSpan={3} className="data__empty">
                    出席者がまだいません。
                  </td>
                </tr>
              )}
              {bySchedule.map((row) => (
                <tr key={row.scheduleId ?? "unknown"}>
                  <td>{row.label}</td>
                  <td>{row.attendingCount} 人</td>
                  <td>{yen(row.subtotal)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
