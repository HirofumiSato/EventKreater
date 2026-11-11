"use client";

import { useCallback, useEffect, useState } from "react";
import { ParticipantListTable } from "@/modules/attendance/components/ParticipantListTable";
import type { ParticipantDraft } from "@/modules/attendance/components/ParticipantSheet";
import { Toast } from "@/components/common/Toast";
import { isRegisterRequired, readProblem, readProblemBody, sendToRegisterRequired } from "@/lib/problem";
import type { EventPricePlanOption, EventScheduleOption, ParticipantRow } from "@/modules/events/types";
import type { RevenueSummary } from "@/modules/revenue/lib/revenue";
import { RevenueSummaryLedger } from "@/modules/revenue/components/RevenueSummaryLedger";
import { MyPageGuideTour } from "@/modules/organizers/components/MyPageGuideTour";
import { Alert, Dialog, Loading, PageHeader } from "@/components/ui";

interface ParticipantsResponse {
  event: {
    id: string;
    title: string;
    capacity: number | null;
    schedules: EventScheduleOption[];
    pricePlans: EventPricePlanOption[];
  };
  stats: { attendingCount: number; declinedCount: number; waitlistedCount: number; totalResponses: number };
  revenue: RevenueSummary;
  participants: ParticipantRow[];
}

export default function ParticipantsPage({ params }: { params: { id: string } }) {
  const [data, setData] = useState<ParticipantsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [toastTone, setToastTone] = useState<"success" | "error">("success");
  /** 見込み売上の内訳を出しているか。既定は閉じ、名簿を先に見せる。 */
  const [revenueOpen, setRevenueOpen] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch(`/api/v1/organizer/events/${params.id}/participants`);
    if (!res.ok) {
      const body = await readProblemBody(res);
      // 未登録の幹事は名簿を開けない。会員登録の案内へ送る。
      if (isRegisterRequired(body)) {
        sendToRegisterRequired(params.id);
        throw new Error("名簿は会員登録が必要です。案内ページへ移動します。");
      }
      throw new Error(body.detail || "読み込みに失敗しました");
    }
    setData((await res.json()) as ParticipantsResponse);
  }, [params.id]);

  useEffect(() => {
    let active = true;
    void load()
      .catch((cause: unknown) => {
        if (active) setError(cause instanceof Error ? cause.message : "読み込みに失敗しました");
      });
    return () => {
      active = false;
    };
  }, [load]);

  const saveRow = async (draft: ParticipantDraft) => {
    // 追加は行がまだ無い（id が null）。編集は既存の行へ送る。
    const creating = draft.id === null;
    const res = await fetch(
      creating
        ? `/api/v1/organizer/events/${params.id}/participants`
        : `/api/v1/organizer/events/${params.id}/participants/${draft.id}`,
      {
        method: creating ? "POST" : "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: draft.name,
          status: draft.status,
          partySize: draft.partySize,
          ...(draft.gender ? { gender: draft.gender } : {}),
          comment: draft.comment ?? "",
          ...(draft.scheduleIds.length > 0 ? { scheduleIds: draft.scheduleIds } : {}),
          ...(draft.pricePlanId ? { pricePlanId: draft.pricePlanId } : {}),
        }),
      },
    );
    if (!res.ok) {
      const message = await readProblem(res);
      setToastTone("error");
      setToast(message);
      throw new Error(message);
    }
    await load();
    setToastTone("success");
    setToast(creating ? "参加者を追加しました" : "出欠を更新しました");
  };

  const deleteRow = async (id: string) => {
    const res = await fetch(`/api/v1/organizer/events/${params.id}/participants/${id}`, { method: "DELETE" });
    if (!res.ok) {
      const message = await readProblem(res);
      setToastTone("error");
      setToast(message);
      throw new Error(message);
    }
    await load();
    setToastTone("success");
    setToast("名簿から削除しました。一番下に残ります。");
  };

  /** 削除済みの行を名簿へ戻す。定員が埋まっていれば 409 の文言をそのまま出す。 */
  const restoreRow = async (id: string) => {
    const res = await fetch(
      `/api/v1/organizer/events/${params.id}/participants/${id}/restore`,
      { method: "POST" },
    );
    if (!res.ok) {
      const message = await readProblem(res);
      setToastTone("error");
      setToast(message);
      throw new Error(message);
    }
    await load();
    setToastTone("success");
    setToast("名簿に戻しました");
  };

  /**
   * 集金を切り替えたあとの帳尻合わせ。
   * 名簿の列はすぐ書き換え、売上の集計はサーバーの値で取り直す（1 枚は開いたまま）。
   */
  const reloadAfterCollection = (id: string, collectedAt: string | null) => {
    setData((current) =>
      current
        ? {
            ...current,
            participants: current.participants.map((row) =>
              row.id === id ? { ...row, collectedAt } : row,
            ),
          }
        : current,
    );
    void load().catch((cause: unknown) => {
      setToastTone("error");
      setToast(cause instanceof Error ? cause.message : "名簿を読み直せませんでした");
    });
  };

  if (error) return <Alert tone="error">{error}</Alert>;
  if (!data) {
    return (
      <Loading>
        参加者を読み込んでいます
      </Loading>
    );
  }

  return (
    <div className="stack">
      <PageHeader
        eyebrow="参加者名簿"
        title={data.event.title}
        actions={
          // 売上の内訳は名簿の前に置くと表を押し下げるので、押したときだけ層で出す。
          <button
            type="button"
            className="btn btn--outline btn--sm"
            onClick={() => setRevenueOpen(true)}
          >
            売上を見る
          </button>
        }
      />

      <div className="roster-summary roster-summary--five">
        <div className="roster-summary__item">
          <span className="roster-summary__label">回答</span>
          <span className="roster-summary__value">
            {data.stats.totalResponses}
            <span>件</span>
          </span>
        </div>
        <div className="roster-summary__item">
          <span className="roster-summary__label">参加</span>
          <span className="roster-summary__value">
            {data.stats.attendingCount}
            <span>人</span>
          </span>
        </div>
        <div className="roster-summary__item">
          <span className="roster-summary__label">参加要望</span>
          <span className="roster-summary__value">
            {data.stats.waitlistedCount}
            <span>人</span>
          </span>
        </div>
        <div className="roster-summary__item">
          <span className="roster-summary__label">欠席</span>
          <span className="roster-summary__value">
            {data.stats.declinedCount}
            <span>人</span>
          </span>
        </div>
        <div className="roster-summary__item roster-summary__item--money">
          <span className="roster-summary__label">集金済み</span>
          <span className="roster-summary__value">
            {data.revenue.collectedRevenue.toLocaleString("ja-JP")}
            <span>円</span>
          </span>
        </div>
      </div>

      {data.revenue.unassignedPlanCount > 0 && (
        <Alert tone="warning">
          料金プラン未選択の参加者が {data.revenue.unassignedPlanCount} 人います。名簿で選ぶと売上に入ります。
        </Alert>
      )}
      <ParticipantListTable
        eventId={params.id}
        rows={data.participants}
        schedules={data.event.schedules}
        pricePlans={data.event.pricePlans}
        attendingCount={data.stats.attendingCount}
        declinedCount={data.stats.declinedCount}
        waitlistedCount={data.stats.waitlistedCount}
        capacity={data.event.capacity}
        onSave={saveRow}
        onDelete={deleteRow}
        onRestore={restoreRow}
        onCollectionChange={reloadAfterCollection}
        onCollectionError={(message) => {
          setToastTone("error");
          setToast(message);
        }}
      />

      {/* 売上の内訳。名簿の表を押し下げないよう、押したときだけ出す。 */}
      {revenueOpen && (
        <Dialog
          title="売上"
          titleId="participants-revenue-title"
          onClose={() => setRevenueOpen(false)}
          actions={
            <button type="button" className="btn btn--sm" onClick={() => setRevenueOpen(false)}>
              閉じる
            </button>
          }
        >
          <RevenueSummaryLedger summary={data.revenue} />
        </Dialog>
      )}

      {/* 主催者ページの操作ガイド。名簿の枚はこの画面で出す（`steps.ts` の `roster`）。 */}
      <MyPageGuideTour ready autoStart={false} />
      {toast && <Toast message={toast} tone={toastTone} onClose={() => setToast(null)} />}
    </div>
  );
}
