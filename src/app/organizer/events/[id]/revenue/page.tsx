"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { OrganizerTabs } from "@/modules/organizers/components/OrganizerTabs";
import { RevenueSummaryLedger } from "@/modules/revenue/components/RevenueSummaryLedger";
import { RevenueAllocationSection } from "@/modules/revenue/components/RevenueAllocationSection";
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
import type { RevenueAllocationView } from "@/modules/revenue/types";

interface EventRevenueResponse {
  event: { id: string; title: string; sortDate: string; status: "DRAFT" | "PUBLISHED" | "CLOSED" };
  summary: RevenueSummary;
  byPlan: PlanRevenueRow[];
  bySchedule: ScheduleRevenueView[];
  allocation: RevenueAllocationView;
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

  const { event, summary, byPlan, bySchedule, allocation } = data;

  return (
    <div className="stack">
      <div>
        <p className="eyebrow">主催者</p>
        <h1 className="page-title">売上の内訳</h1>
        <p className="page-lead">
          {event.title}。{event.sortDate} 開催・{STATUS_LABELS[event.status]}
        </p>
        <div className="panel__actions">
          <Link
            href={`/organizer/events/${params.id}/participants`}
            className="btn btn--outline btn--sm"
          >
            参加者名簿へ
          </Link>
          <Link href="/organizer/revenue" className="btn btn--ghost btn--sm">
            売上一覧へ
          </Link>
        </div>
      </div>

      <OrganizerTabs />

      <section className="panel">
        <RevenueSummaryLedger summary={summary} />
      </section>

      {summary.unassignedPlanCount > 0 && (
        <section className="section">
          <div className="section__head">
            <h2 className="section__title">プラン未選択の参加者</h2>
            <p className="section__note">金額が決まっていない人は、見込みに入りません。</p>
          </div>
          <div className="panel">
            <p className="panel__note panel__note--warning">
              出席しているのに費用プランが未選択の参加者が {summary.unassignedPlanCount} 人います。この人たちは売上に含めていません。
            </p>
            <p className="alert__actions">
              <Link href={`/organizer/events/${params.id}/participants`} className="text-link">
                名簿でプランを選ぶ
              </Link>
            </p>
          </div>
        </section>
      )}

      {allocation.organizerCount > 1 && (
        <RevenueAllocationSection
          eventId={params.id}
          allocation={allocation}
          attendingCount={summary.attendingCount}
          onUpdated={(next) =>
            setData((previous) => (previous ? { ...previous, allocation: next } : previous))
          }
        />
      )}

      <section className="section">
        <div className="section__head">
          <h2 className="section__title">プラン別</h2>
          <p className="section__note">申込時点の金額で数えています。</p>
        </div>
        {byPlan.length === 0 ? (
          <p className="empty">
            <span className="empty__title">プランを選んだ出席者がまだいません。</span>
            <span className="empty__body">名簿から費用プランを選ぶと、ここに小計が出ます。</span>
          </p>
        ) : (
          <ul className="rows">
            {byPlan.map((row) => (
              <li key={`${row.audience}:${row.name}:${row.amount}`} className="rows__item">
                <div className="rows__main">
                  <p className="rows__title">{row.name}</p>
                  <p className="rows__meta">
                    {PRICE_AUDIENCE_LABELS[row.audience]} ／ {row.attendingCount} 人 ／ 1 人{" "}
                    {yen(row.amount)}
                  </p>
                </div>
                <span className="rows__value">{yen(row.subtotal)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="section">
        <div className="section__head">
          <h2 className="section__title">開催回別</h2>
          <p className="section__note">1回だけの催しは、1行になります。</p>
        </div>
        {bySchedule.length === 0 ? (
          <p className="empty">
            <span className="empty__title">出席者がまだいません。</span>
            <span className="empty__body">出欠が入ると、開催回ごとの小計が出ます。</span>
          </p>
        ) : (
          <ul className="rows">
            {bySchedule.map((row) => (
              <li key={row.scheduleId ?? "unknown"} className="rows__item">
                <div className="rows__main">
                  <p className="rows__title">{row.label}</p>
                  <p className="rows__meta">出席 {row.attendingCount} 人</p>
                </div>
                <span className="rows__value">{yen(row.subtotal)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
