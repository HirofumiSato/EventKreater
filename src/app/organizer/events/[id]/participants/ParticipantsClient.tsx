"use client";

import { useCallback, useState } from "react";
import { ParticipantListTable } from "@/modules/attendance/components/ParticipantListTable";
import type { ParticipantDraft } from "@/modules/attendance/components/ParticipantSheet";
import { Toast } from "@/components/common/Toast";
import {
  isRegisterRequired,
  readProblem,
  readProblemBody,
  sendToRegisterRequired,
} from "@/lib/problem";
import { summarizeStatuses } from "@/lib/serializers";
import type { ParticipantRow } from "@/modules/events/types";
import { summarizeRevenue, type RevenueSummary } from "@/modules/revenue/lib/revenue";
import type { RosterPayload, RosterStats } from "@/modules/participants/lib/roster";
import { RevenueSummaryLedger } from "@/modules/revenue/components/RevenueSummaryLedger";
import { MyPageGuideTour } from "@/modules/organizers/components/MyPageGuideTour";
import { Alert, Dialog, PageHeader } from "@/components/ui";

type ParticipantsScreenProps = {
  eventId: string;
  /**
   * サーバーで読んだ名簿。見出しと集計帯を最初の HTML に載せるため、
   * 画面はこの値をそのまま最初の状態にする。
   */
  initialData: RosterPayload | null;
  /** 幹事でない・催しが無いときの案内。null なら名簿は取れている。 */
  initialError: string | null;
};

/** 名簿の行から集計帯の数字を作り直す。削除済みは人数に数えない。 */
function statsOf(rows: readonly ParticipantRow[]): RosterStats {
  const active = rows.filter((row) => row.deletedAt === null);
  return { ...summarizeStatuses(active), deletedCount: rows.length - active.length };
}

/**
 * 名簿の行から売上サマリを作り直す。保存で人数・料金プランが変わったとき、
 * 売上の層を開き直さなくても数字が合うようにする（数え方は `summarizeRevenue`）。
 */
function revenueOf(rows: readonly ParticipantRow[]): RevenueSummary {
  return summarizeRevenue(
    rows
      .filter((row) => row.deletedAt === null)
      .map((row) => ({
        status: row.status,
        priceAmount: row.pricePlanAmount,
        pricePlanName: row.pricePlanLabel,
        priceAudience: null,
        scheduleId: row.scheduleId,
        partySize: row.partySize,
        discounts: row.discounts,
        collectedAt: row.collectedAt,
      })),
  );
}

/** 保存の応答で 1 行だけ差し替える。追加は削除済みの手前（未削除の末尾）へ入れる。 */
function withSavedRow(
  rows: readonly ParticipantRow[],
  next: ParticipantRow,
  creating: boolean,
): ParticipantRow[] {
  const index = rows.findIndex((row) => row.id === next.id);
  if (index >= 0) {
    const copy = [...rows];
    copy[index] = next;
    return copy;
  }
  // 追加の行は名簿の未削除の末尾（作成順）へ。削除済みはその後ろに残す。
  const firstDeleted = creating ? rows.findIndex((row) => row.deletedAt !== null) : -1;
  const at = firstDeleted === -1 ? rows.length : firstDeleted;
  return [...rows.slice(0, at), next, ...rows.slice(at)];
}

/**
 * 集金の切り替えで動くのは集金済みの額と人数だけ。
 * 見込み売上は出席とプランの金額から決まるので、ここでは触らない。
 */
function withCollectedRevenue(
  summary: RevenueSummary,
  row: ParticipantRow,
  collected: boolean,
): RevenueSummary {
  // 出席かつプラン選択済みの行だけが売上に入る（サーバーの `summarizeRevenue` と同じ）。
  if (row.status !== "ATTENDING" || row.payableAmount === null) return summary;
  const collectedRevenue = Math.max(
    0,
    summary.collectedRevenue + (collected ? row.payableAmount : -row.payableAmount),
  );
  const collectedCount = Math.max(0, summary.collectedCount + (collected ? row.partySize : -row.partySize));
  return {
    ...summary,
    collectedRevenue,
    collectedCount,
    uncollected: summary.expectedRevenue - collectedRevenue,
  };
}

export function ParticipantsScreen({ eventId, initialData, initialError }: ParticipantsScreenProps) {
  const [data, setData] = useState<RosterPayload | null>(initialData);
  const [error, setError] = useState<string | null>(initialError);
  const [toast, setToast] = useState<string | null>(null);
  const [toastTone, setToastTone] = useState<"success" | "error">("success");
  /** 見込み売上の内訳を出しているか。既定は閉じ、名簿を先に見せる。 */
  const [revenueOpen, setRevenueOpen] = useState(false);

  /** 名簿を取り直す。削除・復元のあとだけ使う（保存は応答の行で差し替える）。 */
  const load = useCallback(async () => {
    const res = await fetch(`/api/v1/organizer/events/${eventId}/participants`);
    if (!res.ok) {
      const body = await readProblemBody(res);
      // 未登録の幹事は名簿を開けない。会員登録の案内へ送る。
      if (isRegisterRequired(body)) {
        sendToRegisterRequired(eventId);
        throw new Error("名簿は会員登録が必要です。案内ページへ移動します。");
      }
      throw new Error(body.detail || "読み込みに失敗しました");
    }
    setData((await res.json()) as RosterPayload);
  }, [eventId]);

  const saveRow = async (draft: ParticipantDraft) => {
    // 追加は行がまだ無い（id が null）。編集は既存の行へ送る。
    const creating = draft.id === null;
    const res = await fetch(
      creating
        ? `/api/v1/organizer/events/${eventId}/participants`
        : `/api/v1/organizer/events/${eventId}/participants/${draft.id}`,
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
    // PATCH / POST は更新後の 1 行を返す。全件を取り直さず、その行だけ差し替える。
    const body = (await res.json()) as { participant: ParticipantRow };
    setData((current) => {
      if (!current) return current;
      const participants = withSavedRow(current.participants, body.participant, creating);
      return {
        ...current,
        participants,
        stats: statsOf(participants),
        revenue: revenueOf(participants),
      };
    });
    setToastTone("success");
    setToast(creating ? "参加者を追加しました" : "出欠を更新しました");
  };

  const deleteRow = async (id: string) => {
    const res = await fetch(`/api/v1/organizer/events/${eventId}/participants/${id}`, { method: "DELETE" });
    if (!res.ok) {
      const message = await readProblem(res);
      setToastTone("error");
      setToast(message);
      throw new Error(message);
    }
    // 削除は行を消さずに名簿の末尾へ移す。並びと待ち順が変わるので全件を取り直す。
    await load();
    setToastTone("success");
    setToast("名簿から削除しました。一番下に残ります。");
  };

  /** 削除済みの行を名簿へ戻す。定員が埋まっていれば 409 の文言をそのまま出す。 */
  const restoreRow = async (id: string) => {
    const res = await fetch(
      `/api/v1/organizer/events/${eventId}/participants/${id}/restore`,
      { method: "POST" },
    );
    if (!res.ok) {
      const message = await readProblem(res);
      setToastTone("error");
      setToast(message);
      throw new Error(message);
    }
    // 復元は未削除の末尾へ戻る。並びが変わるので全件を取り直す。
    await load();
    setToastTone("success");
    setToast("名簿に戻しました");
  };

  /**
   * 集金を切り替えたあとの帳尻合わせ。
   * 名簿の列と売上の数字を、その場で同じ値にする（全件は取り直さない）。
   */
  const reloadAfterCollection = (id: string, collectedAt: string | null) => {
    setData((current) => {
      if (!current) return current;
      const target = current.participants.find((row) => row.id === id);
      return {
        ...current,
        participants: current.participants.map((row) =>
          row.id === id ? { ...row, collectedAt } : row,
        ),
        revenue: target
          ? withCollectedRevenue(current.revenue, target, collectedAt !== null)
          : current.revenue,
      };
    });
  };

  if (error) return <Alert tone="error">{error}</Alert>;
  if (!data) return <Alert tone="error">読み込みに失敗しました。</Alert>;

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
        eventId={eventId}
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
