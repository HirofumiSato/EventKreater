"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { OrganizerTabs } from "@/modules/organizers/components/OrganizerTabs";
import { RevenueSummaryLedger } from "@/modules/revenue/components/RevenueSummaryLedger";
import { isRegisterRequired, readProblemBody } from "@/lib/problem";
import { registerUrl } from "@/lib/auth-links";
import { SITE } from "@/lib/site";
import { STATUS_LABELS } from "@/modules/events/types";
import type { EventRevenueRow, RevenueSummary } from "@/modules/revenue/lib/revenue";

interface RevenueResponse {
  period: { from: string | null; to: string | null; status: string | null };
  totals: RevenueSummary;
  /** 按分後の自分の見込み取り分（全イベントの合算）。 */
  myShare: { expectedRevenue: number };
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
      <div>
        <p className="eyebrow">主催者</p>
        <h1 className="page-title">売上</h1>
        <p className="page-lead">
          出席者が選んだ費用プランから、見込みの売上を自動で集計します。金額は出欠を入れた時点のものです。
        </p>
        <div className="panel__actions">
          <Link href="/organizer/events" className="btn btn--outline btn--sm">
            主催一覧へ
          </Link>
          <Link href={SITE.nav.createEvent.href} className="btn btn--primary btn--sm">
            新規作成
          </Link>
        </div>
      </div>

      <OrganizerTabs />

      <section className="panel">
        <div className="panel__head">
          <h2 className="panel__title">期間</h2>
          <p className="panel__note">開催日で絞り込みます。初期表示は全期間です。</p>
        </div>
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
          <section className="panel">
            <div className="panel__head">
              <h2 className="panel__title">
                {data.period.from || data.period.to
                  ? `${data.period.from ?? "指定なし"} 〜 ${data.period.to ?? "指定なし"}`
                  : "全期間"}
              </h2>
              <p className="panel__note">見込みと、領収書を出した額の差がそのまま残りです。</p>
            </div>
            <RevenueSummaryLedger summary={totals} myShare={data.myShare} />
          </section>

          {totals.unassignedPlanCount > 0 && (
            <section className="section">
              <div className="section__head">
                <h2 className="section__title">プラン未選択の参加者</h2>
                <p className="section__note">金額が決まっていない人は、見込みに入りません。</p>
              </div>
              <div className="panel">
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
              </div>
            </section>
          )}

          <section className="section">
            <div className="section__head">
              <h2 className="section__title">催し別</h2>
              <p className="section__note">開催日の新しい順です。行を押すと内訳が出ます。</p>
            </div>
            {data.events.length === 0 ? (
              <p className="empty">
                <span className="empty__title">この期間に主催イベントはありません。</span>
                <span className="empty__body">期間を広げるか、新しい催しを作ってください。</span>
              </p>
            ) : (
              <ul className="rows">
                {data.events.map((event) => (
                  <li key={event.id} className="rows__item">
                    <div className="rows__main">
                      <p className="rows__title">
                        <Link href={`/organizer/events/${event.id}/revenue`}>{event.title}</Link>
                        {event.role === "CO_HOST" ? (
                          <span className="badge badge--sm badge--neutral">共同主催</span>
                        ) : null}
                      </p>
                      <p className="rows__meta">
                        {event.sortDate} ／ {STATUS_LABELS[event.status]} ／ 出席{" "}
                        {event.attendingCount}・欠席 {event.declinedCount}
                        {event.unassignedPlanCount > 0 && ` ／ 未選択 ${event.unassignedPlanCount}`}
                      </p>
                      <p className="rows__meta">
                        見込み {yen(event.expectedRevenue)} ／ あなたの取り分{" "}
                        {yen(event.myShare.expectedRevenue)} ／ 発行済み {yen(event.issuedRevenue)} ／
                        差額{" "}
                        <span className={event.unreconciled < 0 ? "text-warning" : undefined}>
                          {yen(event.unreconciled)}
                        </span>
                      </p>
                    </div>
                    <div className="event-card__actions">
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
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <p className="help">
            見込み売上は、参加者が申し込んだ時点の費用プラン金額で計算します。あとからプラン金額を変えても、申込済みの金額は変わりません。
          </p>
        </>
      )}
    </div>
  );
}
