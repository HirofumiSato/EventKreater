"use client";

import { useMemo, useState } from "react";
import { isRegisterRequired, readProblemBody } from "@/lib/problem";
import { equalSharesBps, formatShareBps } from "@/modules/revenue/lib/allocation";
import type { RevenueAllocationView } from "@/modules/revenue/types";

interface Props {
  eventId: string;
  allocation: RevenueAllocationView;
  attendingCount: number;
  onUpdated: (allocation: RevenueAllocationView) => void;
}

type Mode = "RATIO" | "HEADCOUNT";
type Visibility = "ALL" | "OWN_ONLY";

function yen(amount: number): string {
  return `${amount.toLocaleString("ja-JP")}円`;
}

function parseRatioBps(value: string): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.round(parsed * 100) : Number.NaN;
}

function parseHeadcount(value: string): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : Number.NaN;
}

const MODE_LABELS: Record<Mode, string> = {
  RATIO: "割合で分ける",
  HEADCOUNT: "人数で分ける",
};

const VISIBILITY_LABELS: Record<Visibility, string> = {
  ALL: "全員に公開",
  OWN_ONLY: "各自の分だけ",
};

/**
 * 売上画面の「主催者別」。閲覧は全員、編集は主催者だけ。
 * モーダルは増やさず、この節の中で設定パネルを開く。
 */
export function RevenueAllocationSection({
  eventId,
  allocation,
  attendingCount,
  onUpdated,
}: Props) {
  const [editing, setEditing] = useState(false);
  const [mode, setMode] = useState<Mode>(allocation.mode);
  const [visibility, setVisibility] = useState<Visibility>(allocation.visibility);
  const [ratioInputs, setRatioInputs] = useState<Record<string, string>>({});
  const [headcountInputs, setHeadcountInputs] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const startEditing = () => {
    setMode(allocation.mode);
    setVisibility(allocation.visibility);
    // 人数方式から切り替えたときは、割合が 0 のままにならないよう均等割を初期値にする。
    const ratioDefaults =
      allocation.mode === "RATIO"
        ? allocation.rows.map((row) => row.shareBps)
        : equalSharesBps(
            allocation.rows.map((row) => ({ organizerId: row.organizerId, role: row.role })),
          );
    setRatioInputs(
      Object.fromEntries(
        allocation.rows.map((row, index) => [
          row.organizerId,
          formatShareBps(ratioDefaults[index] ?? 0),
        ]),
      ),
    );
    setHeadcountInputs(
      Object.fromEntries(
        allocation.rows.map((row) => [row.organizerId, String(row.headcount ?? 0)]),
      ),
    );
    setError(null);
    setEditing(true);
  };

  const ratioTotal = useMemo(
    () =>
      allocation.rows.reduce((sum, row) => {
        const value = parseRatioBps(ratioInputs[row.organizerId] ?? "0");
        return sum + (Number.isFinite(value) ? value : 0);
      }, 0),
    [allocation.rows, ratioInputs],
  );

  const headcountTotal = useMemo(
    () =>
      allocation.rows.reduce((sum, row) => {
        const value = parseHeadcount(headcountInputs[row.organizerId] ?? "0");
        return sum + (Number.isFinite(value) ? value : 0);
      }, 0),
    [allocation.rows, headcountInputs],
  );

  const save = async () => {
    setPending(true);
    setError(null);
    try {
      const rows = allocation.rows.map((row) => ({
        organizerId: row.organizerId,
        ...(mode === "RATIO"
          ? { shareBps: parseRatioBps(ratioInputs[row.organizerId] ?? "0") }
          : { headcount: parseHeadcount(headcountInputs[row.organizerId] ?? "0") }),
      }));
      const res = await fetch(`/api/v1/organizer/events/${eventId}/revenue/allocation`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode, visibility, rows }),
      });
      if (!res.ok) {
        const body = await readProblemBody(res);
        if (isRegisterRequired(body)) {
          throw new Error("按分の設定には会員登録が必要です。");
        }
        throw new Error(body.detail || "配分を保存できませんでした。");
      }
      const saved = (await res.json()) as { allocation: RevenueAllocationView };
      onUpdated(saved.allocation);
      setEditing(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "配分を保存できませんでした。");
    } finally {
      setPending(false);
    }
  };

  return (
    <section className="table-card">
      <div className="table-card__head">
        <h2 className="table-card__title">主催者別</h2>
        {!editing && allocation.canEdit && (
          <button type="button" className="btn btn--ghost btn--sm" onClick={startEditing}>
            配分を設定
          </button>
        )}
      </div>

      {error && (
        <p className="alert alert--error" style={{ margin: "0 1.25rem 0.75rem" }}>
          {error}
        </p>
      )}

      {!allocation.configured && !editing && (
        <p className="help" style={{ padding: "0 1.25rem 0.75rem" }}>
          まだ配分を保存していません。均等割（{formatShareBps(10000 / Math.max(1, allocation.organizerCount))}%
          前後）で計算しています。
        </p>
      )}

      {editing ? (
        <div className="stack" style={{ padding: "0 1.25rem 1.25rem" }}>
          <div className="chips" role="group" aria-label="按分の方式">
            {(Object.keys(MODE_LABELS) as Mode[]).map((value) => (
              <label key={value} className="chip">
                <input
                  type="radio"
                  name="allocation-mode"
                  value={value}
                  checked={mode === value}
                  onChange={() => setMode(value)}
                />
                {MODE_LABELS[value]}
              </label>
            ))}
          </div>

          <div className="table-card__scroll">
            <table className="data">
              <thead>
                <tr>
                  <th scope="col">名前</th>
                  <th scope="col">立場</th>
                  <th scope="col">{mode === "RATIO" ? "割合（%）" : "人数"}</th>
                </tr>
              </thead>
              <tbody>
                {allocation.rows.map((row) => (
                  <tr key={row.organizerId}>
                    <td>
                      {row.name}
                      {row.isYou && <span className="help">（あなた）</span>}
                    </td>
                    <td className="data__muted">
                      {row.role === "OWNER" ? "主催者" : "共同主催者"}
                      {row.isGuest && "（未登録）"}
                    </td>
                    <td>
                      <input
                        className="input"
                        type="number"
                        min={0}
                        step={mode === "RATIO" ? "0.01" : "1"}
                        inputMode="decimal"
                        aria-label={`${row.name} の${mode === "RATIO" ? "割合" : "人数"}`}
                        value={
                          mode === "RATIO"
                            ? (ratioInputs[row.organizerId] ?? "")
                            : (headcountInputs[row.organizerId] ?? "")
                        }
                        onChange={(event) => {
                          const value = event.currentTarget.value;
                          if (mode === "RATIO") {
                            setRatioInputs((prev) => ({ ...prev, [row.organizerId]: value }));
                          } else {
                            setHeadcountInputs((prev) => ({ ...prev, [row.organizerId]: value }));
                          }
                        }}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="help">
            {mode === "RATIO"
              ? `合計 ${formatShareBps(ratioTotal)}%（100.00% にしてください）`
              : `合計 ${headcountTotal} / ${attendingCount} 人（未割当 ${Math.max(0, attendingCount - headcountTotal)} 人）`}
          </p>

          <div className="chips" role="group" aria-label="按分の公開範囲">
            {(Object.keys(VISIBILITY_LABELS) as Visibility[]).map((value) => (
              <label key={value} className="chip">
                <input
                  type="radio"
                  name="allocation-visibility"
                  value={value}
                  checked={visibility === value}
                  onChange={() => setVisibility(value)}
                />
                {VISIBILITY_LABELS[value]}
              </label>
            ))}
          </div>
          <p className="help">
            主催者は設定にかかわらず全員分を見られます。共同主催者は「各自の分だけ」のとき、自分の行と他の人数だけを見ます。
          </p>

          <div className="btn-row">
            <button type="button" className="btn btn--primary btn--sm" disabled={pending} onClick={() => void save()}>
              {pending ? "保存しています..." : "保存する"}
            </button>
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              disabled={pending}
              onClick={() => {
                setEditing(false);
                setError(null);
              }}
            >
              やめる
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="table-card__scroll">
            <table className="data">
              <thead>
                <tr>
                  <th scope="col">名前</th>
                  <th scope="col">立場</th>
                  <th scope="col">{allocation.mode === "RATIO" ? "割合" : "人数"}</th>
                  <th scope="col">見込み</th>
                  <th scope="col">発行済み</th>
                </tr>
              </thead>
              <tbody>
                {allocation.rows.map((row) => (
                  <tr key={row.organizerId}>
                    <td>
                      {row.name}
                      {row.isYou && <span className="help">（あなた）</span>}
                    </td>
                    <td className="data__muted">
                      {row.role === "OWNER" ? "主催者" : "共同主催者"}
                      {row.isGuest && "（未登録）"}
                    </td>
                    <td className="num">
                      {allocation.mode === "RATIO"
                        ? `${formatShareBps(row.shareBps)}%`
                        : `${row.headcount ?? 0} 人`}
                    </td>
                    <td className="num">{yen(row.expectedRevenue)}</td>
                    <td className="num">{yen(row.issuedRevenue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {allocation.hiddenRows > 0 && (
            <p className="help" style={{ padding: "0.75rem 1.25rem 0" }}>
              他の {allocation.hiddenRows} 人分は非表示です。
            </p>
          )}

          {allocation.mode === "HEADCOUNT" &&
            (allocation.unallocated.headcount > 0 ||
              allocation.unallocated.expectedRevenue > 0) && (
              <p className="help" style={{ padding: "0.75rem 1.25rem 0" }}>
                未割当 {allocation.unallocated.headcount} 人・
                {yen(allocation.unallocated.expectedRevenue)}。売上から消えたわけではありません。
              </p>
            )}

          <p className="help" style={{ padding: "0.75rem 1.25rem 1.25rem" }}>
            按分は集金の分担を決めるための表示です。送金や決済は行いません。
          </p>
        </>
      )}
    </section>
  );
}
