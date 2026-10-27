"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { currentMonthBounds, yen } from "@/lib/format";
import { RevenueSummaryLedger } from "@/modules/revenue/components/RevenueSummaryLedger";
import { isRegisterRequired, readProblemBody } from "@/lib/problem";
import { registerUrl } from "@/lib/auth-links";
import { SITE } from "@/lib/site";
import { STATUS_LABELS } from "@/modules/events/types";
import type { EventRevenueRow, RevenueSummary } from "@/modules/revenue/lib/revenue";
import { Badge, EmptyState, Loading, PageHeader, Panel, PanelHead, Row, Rows, Section, SectionHead } from "@/components/ui";

interface RevenueResponse {
  period: { from: string | null; to: string | null; status: string | null };
  totals: RevenueSummary;
  /** 按分後の自分の見込み取り分（全イベントの合算）。 */
  myShare: { expectedRevenue: number };
  events: EventRevenueRow[];
}

type Range = "ALL" | "MONTH" | "CUSTOM";

export default function OrganizerRevenuePage() {
  const [range, setRange] = useState<Range>("ALL");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [data, setData] = useState<RevenueResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [registerRequired, setRegisterRequired] = useState(false);
  const [loading, setLoading] = useState(true);

  const query = useMemo(() => {
    if (range === "ALL") return "";
    if (range === "MONTH") {
      const bounds = currentMonthBounds();
      return `?from=${bounds.from}&to=${bounds.to}`;
    }
    const params = new URLSearchParams();
    if (customFrom) params.set("from", customFrom);
    if (customTo) params.set("to", customTo);
    const value = params.toString();
    return value ? `?${value}` : "";
  }, [range, customFrom, customTo]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/v1/organizer/revenue${query}`, { cache: "no-store" });
      if (res.status === 401) {
        setError("ログインすると売上を確認できます。");
        setRegisterRequired(false);
        setData(null);
        return;
      }
      if (!res.ok) {
        const body = await readProblemBody(res);
        if (isRegisterRequired(body)) {
          setRegisterRequired(true);
          setError(body.detail || "売上の管理には会員登録が必要です。");
          setData(null);
          return;
        }
        setError(body.detail || "売上の読み込みに失敗しました。");
        setData(null);
        return;
      }
      setData((await res.json()) as RevenueResponse);
      setRegisterRequired(false);
      setError(null);
    } catch {
      setError("売上の読み込みに失敗しました。");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [query]);

  useEffect(() => {
    void load();
  }, [load]);

  const totals = data?.totals;
  const unassignedEvents = (data?.events ?? []).filter((event) => event.unassignedPlanCount > 0);

  return (
    <div className="stack">
      <PageHeader
        title="売上"
        lead="出席者が選んだ費用プランから、見込みの売上を自動で集計します。金額は出欠を入れた時点のものです。"
        actions={<><Link href="/organizer/events" className="btn btn--outline btn--sm">
            主催一覧へ
          </Link>
          <Link href={SITE.nav.createEvent.href} className="btn btn--primary btn--sm">
            新規作成
          </Link></>}
      />

      <Panel>
        <PanelHead title="期間" note="開催日で絞り込みます。初期表示は全期間です。" />
        <div className="chips" role="group" aria-label="集計する期間">
          {(
            [
              ["ALL", "全期間"],
              ["MONTH", "今月"],
              ["CUSTOM", "期間を指定"],
            ] as const
          ).map(([value, label]) => (
            <label key={value} className="chip">
              <input
                type="radio"
                name="revenue-range"
                value={value}
                checked={range === value}
                onChange={() => setRange(value)}
              />
              {label}
            </label>
          ))}
        </div>
        {range === "CUSTOM" && (
          <div className="chips">
            <label className="label" htmlFor="revenue-from">
              開始
            </label>
            <input
              id="revenue-from"
              type="date"
              className="input"
              value={customFrom}
              onChange={(event) => setCustomFrom(event.currentTarget.value)}
            />
            <label className="label" htmlFor="revenue-to">
              終了
            </label>
            <input
              id="revenue-to"
              type="date"
              className="input"
              value={customTo}
              onChange={(event) => setCustomTo(event.currentTarget.value)}
            />
          </div>
        )}
      </Panel>

      {loading && (
        <Loading>
          売上を集計しています
        </Loading>
      )}

      {!loading && error && (
        <section className="alert alert--warning">
          <p>{error}</p>
          {registerRequired ? (
            <p className="alert__actions">
              <Link href={registerUrl("/organizer/revenue")} className="btn btn--primary btn--sm">
                会員登録して売上を見る
              </Link>
            </p>
          ) : (
            <p className="alert__actions">
              <Link href="/auth/register?mode=login&next=/organizer/revenue" className="text-link">
                主催者ログイン
              </Link>
            </p>
          )}
        </section>
      )}

      {!loading && !error && totals && (
        <>
          <Panel>
            <PanelHead
              title={<>{data.period.from || data.period.to
                  ? `${data.period.from ?? "指定なし"} 〜 ${data.period.to ?? "指定なし"}`
                  : "全期間"}</>}
              note="見込みと、領収書を出した額の差がそのまま残りです。"
            />
            <RevenueSummaryLedger summary={totals} myShare={data.myShare} />
          </Panel>

          {totals.unassignedPlanCount > 0 && (
            <Section>
              <SectionHead title="プラン未選択の参加者" note="金額が決まっていない人は、見込みに入りません。" />
              <Panel as="div">
                <p className="panel__note panel__note--warning">
                  出席しているのに費用プランが未選択の参加者が {totals.unassignedPlanCount} 人います。この人たちは売上に含めていません。名簿でプランを選ぶと集計に入ります。
                </p>
                <ul className="alert__list">
                  {unassignedEvents.map((event) => (
                    <li key={event.id}>
                      <Link href={`/organizer/events/${event.id}/participants`} className="text-link">
                        {event.title}（{event.unassignedPlanCount} 人）
                      </Link>
                    </li>
                  ))}
                </ul>
              </Panel>
            </Section>
          )}

          <Section>
            <SectionHead title="催し別" note="開催日の新しい順です。行を押すと内訳が出ます。" />
            {data.events.length === 0 ? (
              <EmptyState>
                <span className="empty__title">この期間に主催イベントはありません。</span>
                <span className="empty__body">期間を広げるか、新しい催しを作ってください。</span>
              </EmptyState>
            ) : (
              <Rows>
                {data.events.map((event) => (
                  <Row
                    title={<><Link href={`/organizer/events/${event.id}/revenue`}>{event.title}</Link>
                        {event.role === "CO_HOST" ? (
                          <Badge tone="neutral" small>共同主催</Badge>
                        ) : null}</>}
                    meta={<>{event.sortDate} ／ {STATUS_LABELS[event.status]} ／ 出席{" "}
                        {event.attendingCount}・欠席 {event.declinedCount}
                        {event.unassignedPlanCount > 0 && ` ／ 未選択 ${event.unassignedPlanCount}`}</>}
                    aside={<><div className="event-card__actions">
                      <Link
                        href={`/organizer/events/${event.id}/revenue`}
                        className="btn btn--ghost btn--sm"
                      >
                        内訳
                      </Link>
                      <Link
                        href={`/organizer/events/${event.id}/participants`}
                        className="btn btn--ghost btn--sm"
                      >
                        名簿
                      </Link>
                    </div></>}
                    key={event.id}
                  >
                    <p className="rows__meta">
                        見込み {yen(event.expectedRevenue)} ／ あなたの取り分{" "}
                        {yen(event.myShare.expectedRevenue)} ／ 発行済み {yen(event.issuedRevenue)} ／
                        差額{" "}
                        <span className={event.unreconciled < 0 ? "text-warning" : undefined}>
                          {yen(event.unreconciled)}
                        </span>
                      </p>
                  </Row>
                ))}
              </Rows>
            )}
          </Section>

          <p className="help">
            見込み売上は、参加者が申し込んだ時点の費用プラン金額で計算します。あとからプラン金額を変えても、申込済みの金額は変わりません。
          </p>
        </>
      )}
    </div>
  );
}
