"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { yen } from "@/lib/format";
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
import { Alert, EmptyState, Loading, PageHeader, Panel, Row, Rows, Section, SectionHead } from "@/components/ui";

interface EventRevenueResponse {
  event: { id: string; title: string; sortDate: string; status: "DRAFT" | "PUBLISHED" | "CLOSED" };
  summary: RevenueSummary;
  byPlan: PlanRevenueRow[];
  bySchedule: ScheduleRevenueView[];
  allocation: RevenueAllocationView;
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

  if (error) return <Alert tone="error">{error}</Alert>;
  if (loading || !data) {
    return (
      <Loading>
        売上を集計しています
      </Loading>
    );
  }

  const { event, summary, byPlan, bySchedule, allocation } = data;

  return (
    <div className="stack">
      <PageHeader
        title="売上の内訳"
        lead={<>{event.title}。{event.sortDate} 開催・{STATUS_LABELS[event.status]}</>}
        actions={<><Link
            href={`/organizer/events/${params.id}/participants`}
            className="btn btn--outline btn--sm"
          >
            参加者名簿へ
          </Link>
          <Link href="/organizer/revenue" className="btn btn--ghost btn--sm">
            売上一覧へ
          </Link></>}
      />

      <Panel>
        <RevenueSummaryLedger summary={summary} />
      </Panel>

      {summary.unassignedPlanCount > 0 && (
        <Section>
          <SectionHead title="プラン未選択の参加者" note="金額が決まっていない人は、見込みに入りません。" />
          <Panel as="div">
            <p className="panel__note panel__note--warning">
              出席しているのに費用プランが未選択の参加者が {summary.unassignedPlanCount} 人います。この人たちは売上に含めていません。
            </p>
            <p className="alert__actions">
              <Link href={`/organizer/events/${params.id}/participants`} className="text-link">
                名簿でプランを選ぶ
              </Link>
            </p>
          </Panel>
        </Section>
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

      <Section>
        <SectionHead title="プラン別" note="申込時点の金額で数えています。" />
        {byPlan.length === 0 ? (
          <EmptyState>
            <span className="empty__title">プランを選んだ出席者がまだいません。</span>
            <span className="empty__body">名簿から費用プランを選ぶと、ここに小計が出ます。</span>
          </EmptyState>
        ) : (
          <Rows>
            {byPlan.map((row) => (
              <Row
                title={<>{row.name}</>}
                meta={<>{PRICE_AUDIENCE_LABELS[row.audience]} ／ {row.attendingCount} 人 ／ 1 人{" "}
                    {yen(row.amount)}</>}
                aside={<><span className="rows__value">{yen(row.subtotal)}</span></>}
                key={`${row.audience}:${row.name}:${row.amount}`}
              />
            ))}
          </Rows>
        )}
      </Section>

      <Section>
        <SectionHead title="開催回別" note="1回だけの催しは、1行になります。" />
        {bySchedule.length === 0 ? (
          <EmptyState>
            <span className="empty__title">出席者がまだいません。</span>
            <span className="empty__body">出欠が入ると、開催回ごとの小計が出ます。</span>
          </EmptyState>
        ) : (
          <Rows>
            {bySchedule.map((row) => (
              <Row
                title={<>{row.label}</>}
                meta={<>出席 {row.attendingCount} 人</>}
                aside={<><span className="rows__value">{yen(row.subtotal)}</span></>}
                key={row.scheduleId ?? "unknown"}
              />
            ))}
          </Rows>
        )}
      </Section>
    </div>
  );
}
