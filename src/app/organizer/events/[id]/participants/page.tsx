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

function yen(amount: number): string {
  return `${amount.toLocaleString("ja-JP")}円`;
}

interface ParticipantsResponse {
  event: {
    id: string;
    title: string;
    capacity: number | null;
    schedules: EventScheduleOption[];
    pricePlans: EventPricePlanOption[];
  };
  stats: { attendingCount: number; declinedCount: number; totalResponses: number };
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
        throw new Error("出欠の確認には会員登録が必要です。案内ページへ移動しています。");
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

  if (error) return <p className="alert alert--error">{error}</p>;
  if (!data) {
    return (
      <p className="loading">
        <span className="spinner" aria-hidden="true" />
        参加者を読み込んでいます
      </p>
    );
  }

  return (
    <div className="stack">
      <section className="panel">
        <div>
          <h1 className="page-title">参加者名簿</h1>
          <p className="page-lead">
            {data.event.title}。参加 {data.stats.attendingCount} / 不参加 {data.stats.declinedCount}
            {data.event.capacity !== null && ` / 定員 ${data.event.capacity}`}
          </p>
        </div>
        <div className="panel__actions">
          <button type="button" className="btn" disabled={sending} onClick={() => void sendReminder()}>
            {sending ? "送っています..." : "参加者へリマインド"}
          </button>
          <button type="button" className="btn btn--outline" disabled={copyingText} onClick={() => void copyReminderText()}>
            {copyingText ? "準備中..." : "文面をコピー"}
          </button>
          <Link href={`/events/${params.id}`} target="_blank" rel="noreferrer" className="btn btn--outline">
            参加者ページをプレビュー
          </Link>
          <button type="button" className="btn btn--outline" onClick={() => void copyShareLink()}>
            {copiedLink ? "コピーしました" : "共有リンクをコピー"}
          </button>
          <Link href={`/organizer/events/${params.id}/revenue`} className="btn btn--ghost">
            売上の内訳
          </Link>
          <Link href={`/organizer/events/${params.id}/edit`} className="btn btn--ghost">
            編集へ戻る
          </Link>
        </div>
      </section>
      <section className="revenue-grid">
        <article className="stat">
          <p className="stat__label">見込み売上</p>
          <p className="stat__value">{yen(data.revenue.expectedRevenue)}</p>
          <p className="help">
            出席 {data.revenue.attendingCount} 人中 {data.revenue.paidAttendingCount} 人がプラン選択済み
          </p>
        </article>
        <article className="stat">
          <p className="stat__label">領収書発行額</p>
          <p className="stat__value">{yen(data.revenue.issuedRevenue)}</p>
          <p className="help">{data.revenue.receiptCount} 件を発行済み</p>
        </article>
        <article className="stat">
          <p className="stat__label">見込みとの差額</p>
          <p className={`stat__value${data.revenue.unreconciled < 0 ? " stat__value--warning" : ""}`}>
            {yen(data.revenue.unreconciled)}
          </p>
          <p className="help">未回収額ではありません。</p>
        </article>
        <article className="stat">
          <p className="stat__label">平均単価</p>
          <p className="stat__value">{yen(data.revenue.averagePerAttendee)}</p>
          <p className="help">プラン選択済みの出席者1人あたり</p>
        </article>
      </section>
      {data.revenue.unassignedPlanCount > 0 && (
        <p className="alert alert--warning">
          出席しているのに費用プランが未選択の参加者が {data.revenue.unassignedPlanCount} 人います。表の「費用プラン」を選ぶと売上に入ります。
        </p>
      )}
      <ParticipantListTable
        rows={data.participants}
        schedules={data.event.schedules}
        pricePlans={data.event.pricePlans}
        attendingCount={data.stats.attendingCount}
        declinedCount={data.stats.declinedCount}
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
          suggestedAmount={issuing.pricePlanAmount}
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
