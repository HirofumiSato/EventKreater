"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { OrganizerTabs } from "@/modules/organizers/components/OrganizerTabs";
import { RevenueSummaryLedger } from "@/modules/revenue/components/RevenueSummaryLedger";
import { isRegisterRequired, readProblemBody } from "@/lib/problem";
import { STATUS_LABELS } from "@/modules/events/types";
import type { EventRevenueRow, RevenueSummary } from "@/modules/revenue/lib/revenue";

interface RevenueResponse {
  period: { from: string | null; to: string | null; status: string | null };
  totals: RevenueSummary;
  events: EventRevenueRow[];
}

type Range = "ALL" | "MONTH" | "CUSTOM";

/** 円は「3,000円」で揃える。0 円を「無料」と言い換えない（売上は無料ではない）。 */
function yen(amount: number): string {
  return `${amount.toLocaleString("ja-JP")}円`;
}

function isoDate(year: number, monthIndex: number, day: number): string {
  const value = new Date(Date.UTC(year, monthIndex, day));
  return value.toISOString().slice(0, 10);
}

/** 日本時間の「今月」を YYYY-MM-DD の範囲にする。 */
function currentMonthBounds(now = new Date()): { from: string; to: string } {
  const shifted = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const year = shifted.getUTCFullYear();
  const month = shifted.getUTCMonth();
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return { from: isoDate(year, month, 1), to: isoDate(year, month, lastDay) };
}

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
      <OrganizerTabs />

      <section className="panel">
        <div>
          <h1 className="page-title">売上</h1>
          <p className="page-lead">
            出席者が選んだ費用プランから、見込みの売上を自動で集計します。金額は出欠を入れた時点のものです。
          </p>
        </div>
        <div className="panel__actions">
          <Link href="/organizer/events" className="btn btn--outline">
            主催一覧へ
          </Link>
          <Link href="/organizer/events/new" className="btn btn--primary">
            新規作成
          </Link>
        </div>
      </section>

      <section className="panel">
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
          <div className="chips" style={{ marginTop: "0.75rem" }}>
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
        <p className="help">開催日で絞り込みます。初期表示は全期間です。</p>
      </section>

      {loading && (
        <p className="loading">
          <span className="spinner" aria-hidden="true" />
          売上を集計しています
        </p>
      )}

      {!loading && error && (
        <section className="alert alert--warning">
          <p>{error}</p>
          {registerRequired ? (
            <p style={{ marginTop: "0.5rem" }}>
              <Link href="/auth/register?next=/organizer/revenue" className="btn btn--primary btn--sm">
                会員登録して売上を見る
              </Link>
            </p>
          ) : (
            <p style={{ marginTop: "0.5rem" }}>
              <Link href="/auth/register?mode=login&next=/organizer/revenue" className="text-link">
                主催者ログイン
              </Link>
            </p>
          )}
        </section>
      )}

      {!loading && !error && totals && (
        <>
          <RevenueSummaryLedger summary={totals} />

          {totals.unassignedPlanCount > 0 && (
            <section className="alert alert--warning">
              <p>
                出席しているのに費用プランが未選択の参加者が {totals.unassignedPlanCount} 人います。この人たちは売上に含めていません。名簿でプランを選ぶと集計に入ります。
              </p>
              <ul className="stack" style={{ marginTop: "0.5rem" }}>
                {unassignedEvents.map((event) => (
                  <li key={event.id}>
                    <Link href={`/organizer/events/${event.id}/participants`} className="text-link">
                      {event.title}（{event.unassignedPlanCount} 人）
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section className="table-card">
            <div className="table-card__head">
              <h2 className="table-card__title">イベント別</h2>
              <p className="help">
                {data.period.from || data.period.to
                  ? `${data.period.from ?? "指定なし"} 〜 ${data.period.to ?? "指定なし"}`
                  : "全期間"}
              </p>
            </div>
            <div className="table-card__scroll">
              <table className="data">
                <thead>
                  <tr>
                    <th scope="col">イベント</th>
                    <th scope="col">開催日</th>
                    <th scope="col">状態</th>
                    <th scope="col">出席 / 欠席</th>
                    <th scope="col">見込み</th>
                    <th scope="col">発行済み</th>
                    <th scope="col">差額</th>
                  </tr>
                </thead>
                <tbody>
                  {data.events.length === 0 && (
                    <tr>
                      <td colSpan={7} className="data__empty">
                        この期間に主催イベントはありません。
                      </td>
                    </tr>
                  )}
                  {data.events.map((event) => (
                    <tr key={event.id}>
                      <td>
                        <Link href={`/organizer/events/${event.id}/revenue`} className="text-link">
                          {event.title}
                        </Link>
                      </td>
                      <td>{event.sortDate}</td>
                      <td className="data__muted">{STATUS_LABELS[event.status]}</td>
                      <td>
                        {event.attendingCount} / {event.declinedCount}
                        {event.unassignedPlanCount > 0 && (
                          <span className="help">（未選択 {event.unassignedPlanCount}）</span>
                        )}
                      </td>
                      <td>{yen(event.expectedRevenue)}</td>
                      <td>{yen(event.issuedRevenue)}</td>
                      <td className={event.unreconciled < 0 ? "stat__value--warning" : undefined}>
                        {yen(event.unreconciled)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <p className="help">
            見込み売上は、参加者が申し込んだ時点の費用プラン金額で計算します。あとからプラン金額を変えても、申込済みの金額は変わりません。
          </p>
        </>
      )}
    </div>
  );
}
