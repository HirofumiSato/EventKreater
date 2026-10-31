"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ParticipantListTable } from "@/modules/attendance/components/ParticipantListTable";
import { ReceiptIssueModal } from "@/modules/receipts/components/ReceiptIssueModal";
import { Toast } from "@/components/common/Toast";
import { isRegisterRequired, readProblem, readProblemBody, sendToRegisterRequired } from "@/lib/problem";
import type { EventPricePlanOption, EventScheduleOption, ParticipantRow } from "@/modules/events/types";
import type { RevenueSummary } from "@/modules/revenue/lib/revenue";
import { RevenueSummaryLedger } from "@/modules/revenue/components/RevenueSummaryLedger";
import { Alert, Loading, PageHeader, Panel } from "@/components/ui";

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
  const router = useRouter();
  const [data, setData] = useState<ParticipantsResponse | null>(null);
  const [issuing, setIssuing] = useState<ParticipantRow | null>(null);
  const [issuingBusy, setIssuingBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [toastTone, setToastTone] = useState<"success" | "error">("success");
  const [sending, setSending] = useState(false);
  const [copyingText, setCopyingText] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);

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

  const saveRow = async (
    row: Pick<
      ParticipantRow,
      "id" | "name" | "status" | "gender" | "comment" | "scheduleId" | "pricePlanId"
    >,
  ) => {
    const res = await fetch(`/api/v1/organizer/events/${params.id}/participants/${row.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: row.name,
        status: row.status,
        ...(row.gender ? { gender: row.gender } : {}),
        comment: row.comment ?? "",
        ...(row.scheduleId ? { scheduleId: row.scheduleId } : {}),
        ...(row.pricePlanId ? { pricePlanId: row.pricePlanId } : {}),
      }),
    });
    if (!res.ok) {
      const message = await readProblem(res);
      setToastTone("error");
      setToast(message);
      throw new Error(message);
    }
    await load();
    setToastTone("success");
    setToast("出欠を更新しました");
  };

  const deleteRow = async (id: string) => {
    const res = await fetch(`/api/v1/organizer/events/${params.id}/participants/${id}`, { method: "DELETE" });
    if (!res.ok) {
      setToastTone("error");
      setToast(await readProblem(res));
      return;
    }
    await load();
    setToastTone("success");
    setToast("参加者を削除しました");
  };

  const issueReceipt = async (input: { addressee: string; amount: number; description: string }) => {
    if (!issuing) return;
    setIssuingBusy(true);
    try {
      const res = await fetch(`/api/v1/organizer/events/${params.id}/participants/${issuing.id}/receipt`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      if (!res.ok) throw new Error(await readProblem(res));
      const participantId = issuing.id;
      setIssuing(null);
      router.push(`/organizer/events/${params.id}/receipts/${participantId}`);
    } catch (cause) {
      setToastTone("error");
      setToast(cause instanceof Error ? cause.message : "領収書の発行に失敗しました");
      setIssuingBusy(false);
    }
  };

  const sendReminder = async () => {
    setSending(true);
    try {
      const res = await fetch(`/api/v1/organizer/events/${params.id}/reminders`, { method: "POST" });
      if (!res.ok) throw new Error(await readProblem(res));
      const body = (await res.json()) as { sent: number; recorded: number; skippedGuests: number };
      const delivery = body.sent > 0 ? `${body.sent}通を送信しました` : `${body.recorded}通を送信記録に残しました`;
      setToastTone("success");
      setToast(
        body.skippedGuests > 0
          ? `${delivery}。アカウントのない参加者 ${body.skippedGuests}人は、文面をコピーして個別に連絡してください。`
          : delivery,
      );
    } catch (cause) {
      setToastTone("error");
      setToast(cause instanceof Error ? cause.message : "リマインドに失敗しました");
    } finally {
      setSending(false);
    }
  };

  const copyReminderText = async () => {
    setCopyingText(true);
    try {
      const res = await fetch(`/api/v1/organizer/events/${params.id}/reminders`);
      if (!res.ok) throw new Error(await readProblem(res));
      const body = (await res.json()) as { subject: string; body: string };
      await navigator.clipboard.writeText(`${body.subject}\n\n${body.body}`);
      setToastTone("success");
      setToast("リマインドの文面をコピーしました。LINE や DM に貼って送れます。");
    } catch (cause) {
      setToastTone("error");
      setToast(cause instanceof Error ? cause.message : "文面のコピーに失敗しました");
    } finally {
      setCopyingText(false);
    }
  };

  const copyShareLink = async () => {
    await navigator.clipboard.writeText(`${window.location.origin}/events/${params.id}`);
    setCopiedLink(true);
    setToastTone("success");
    setToast("参加者用の共有リンクをコピーしました。");
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
      <PageHeader title="参加者名簿" lead={<>{data.event.title}</>} />

      <div className="roster-summary">
        <div className="roster-summary__item">
          <span className="roster-summary__label">回答</span>
          <span className="roster-summary__value">
            {data.stats.totalResponses}
            <span>人</span>
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
            {data.revenue.issuedRevenue.toLocaleString("ja-JP")}
            <span>円</span>
          </span>
        </div>
      </div>

      <Panel>
        <div className="panel__actions">
          <button
            type="button"
            className="btn btn--primary btn--sm"
            disabled={sending}
            onClick={() => void sendReminder()}
          >
            {sending ? "送っています…" : "参加者へリマインド"}
          </button>
          <button
            type="button"
            className="btn btn--outline btn--sm"
            disabled={copyingText}
            onClick={() => void copyReminderText()}
          >
            {copyingText ? "準備しています…" : "文面をコピー"}
          </button>
          <Link
            href={`/events/${params.id}`}
            target="_blank"
            rel="noreferrer"
            className="btn btn--outline btn--sm"
          >
            ページを見る
          </Link>
          <button
            type="button"
            className="btn btn--outline btn--sm"
            onClick={() => void copyShareLink()}
          >
            {copiedLink ? "コピーしました" : "共有リンクをコピー"}
          </button>
          <Link href={`/organizer/events/${params.id}/revenue`} className="btn btn--ghost btn--sm">
            売上の内訳
          </Link>
          <Link href={`/organizer/events/${params.id}/edit`} className="btn btn--ghost btn--sm">
            編集へ戻る
          </Link>
        </div>
        <p className="screen-note">
          リマインドはアカウントのある参加者だけ。ほかは文面をコピーして送ってください。
        </p>
      </Panel>

      <Panel>
        <RevenueSummaryLedger summary={data.revenue} />
      </Panel>

      {data.revenue.unassignedPlanCount > 0 && (
        <Alert tone="warning">
          費用プラン未選択の参加者が {data.revenue.unassignedPlanCount} 人います。名簿で選ぶと売上に入ります。
        </Alert>
      )}
      <ParticipantListTable
        rows={data.participants}
        schedules={data.event.schedules}
        pricePlans={data.event.pricePlans}
        attendingCount={data.stats.attendingCount}
        declinedCount={data.stats.declinedCount}
        waitlistedCount={data.stats.waitlistedCount}
        onSave={saveRow}
        onDelete={deleteRow}
        onIssueReceipt={(row) => {
          if (row.receipt) {
            router.push(`/organizer/events/${params.id}/receipts/${row.id}`);
            return;
          }
          setIssuing(row);
        }}
      />
      {issuing && (
        <ReceiptIssueModal
          participantName={issuing.name}
          suggestedDescription={issuing.pricePlanLabel ?? "イベント参加費"}
          suggestedAmount={issuing.payableAmount}
          reissue={Boolean(issuing.receipt)}
          busy={issuingBusy}
          onClose={() => setIssuing(null)}
          onSubmit={issueReceipt}
        />
      )}
      {toast && <Toast message={toast} tone={toastTone} onClose={() => setToast(null)} />}
    </div>
  );
}
