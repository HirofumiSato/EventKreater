"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { OrganizerTabs } from "@/modules/organizers/components/OrganizerTabs";
import { EventLifecycleModal } from "@/modules/organizers/components/EventLifecycleModal";
import { Toast } from "@/components/common/Toast";
import { readProblem } from "@/lib/problem";
import { priceLabel, scheduleLabel } from "@/lib/serializers";
import { SITE } from "@/lib/site";
import { STATUS_LABELS, type OrganizerEvent } from "@/modules/events/types";

/**
 * 下書き一覧。
 *
 * 主催一覧（SCR-ORG-01）には公開済みと受付停止だけを出し、下書きはここへ分ける。
 * 出欠の統計が常に 0 のカードが並ぶと、公開中の催しの状況が読み取りにくくなるため。
 */
export default function OrganizerDraftsPage() {
  const [events, setEvents] = useState<OrganizerEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/v1/organizer/events", { cache: "no-store" });
    if (res.status === 401) {
      setError("ログインするか、幹事トークン付きの端末で開いてください。");
      setEvents([]);
      return;
    }
    if (!res.ok) {
      setError(await readProblem(res));
      return;
    }
    const data = (await res.json()) as { events: OrganizerEvent[] };
    // 一覧 API は全件を返す。他の画面（マイページ・カレンダー）が全件前提なので、絞り込みはここで行う。
    setEvents(data.events.filter((event) => event.status === "DRAFT"));
    setError(null);
  }, []);

  useEffect(() => {
    void load().finally(() => setLoading(false));
  }, [load]);

  const removeDraft = async (id: string) => {
    setBusyId(id);
    try {
      const res = await fetch(`/api/v1/organizer/events/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error(await readProblem(res));
      setToast("下書きを削除しました");
      setDeletingId(null);
      await load();
    } catch (cause) {
      setToast(cause instanceof Error ? cause.message : "削除に失敗しました");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="stack">
      <div>
        <p className="eyebrow">主催者</p>
        <h1 className="page-title">下書き一覧</h1>
        <p className="page-lead">
          公開するまで、利用枠は減りません。プレビューで見た目を確かめてから公開できます。
        </p>
      </div>

      <OrganizerTabs />

      {loading && (
        <p className="loading">
          <span className="spinner" aria-hidden="true" />
          読み込んでいます
        </p>
      )}
      {error && (
        <p className="alert alert--warning">
          {error}{" "}
          <Link href={SITE.nav.organizerLogin.href} className="text-link">
            {SITE.nav.organizerLogin.label}
          </Link>
        </p>
      )}
      {!loading && !error && events.length === 0 && (
        <div className="empty">
          <p className="empty__title">下書きはありません。</p>
          <p className="empty__body">
            <Link href={SITE.nav.createEvent.href} className="text-link">
              {SITE.cta.createEventFirst}
            </Link>
          </p>
        </div>
      )}

      <div className="stack">
        {events.map((event) => (
          <article key={event.id} className="draft-card">
            <div>
              <p className="draft-card__title">
                {event.title}
                <span className="badge badge--sm badge--neutral">
                  {STATUS_LABELS[event.status]} · {event.role === "OWNER" ? "主催" : "共同主催"}
                </span>
              </p>
              <p className="draft-card__meta">
                {scheduleLabel(event.schedules)} ／ {event.location || "場所未定"}
                <br />
                {priceLabel(event.pricePlans)}
              </p>
            </div>
            <div className="draft-card__actions">
              <Link href={`/organizer/events/${event.id}/preview`} className="btn btn--primary btn--sm">
                プレビュー
              </Link>
              <Link href={`/organizer/events/${event.id}/edit`} className="btn btn--outline btn--sm">
                編集
              </Link>
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                disabled={busyId === event.id}
                onClick={() => setDeletingId(event.id)}
              >
                削除
              </button>
            </div>
          </article>
        ))}
      </div>

      <p className="screen-note">
        下書きは、自分（と共同幹事）にだけ見えます。URL を知っていても、公開していない催しは開けません。
        削除すると元に戻せません。
      </p>

      <div className="panel__actions">
        <Link href={SITE.nav.createEvent.href} className="btn btn--primary btn--sm">
          新しく作る
        </Link>
        <Link href="/organizer/events" className="btn btn--outline btn--sm">
          主催一覧へ戻る
        </Link>
      </div>

      {deletingId && (
        <EventLifecycleModal
          title={events.find((event) => event.id === deletingId)?.title ?? "下書き"}
          status="DRAFT"
          busy={busyId === deletingId}
          onClose={() => setDeletingId(null)}
          onStop={() => undefined}
          onDelete={() => void removeDraft(deletingId)}
        />
      )}
      {toast && (
        <Toast message={toast} tone={toast.includes("失敗") ? "error" : "success"} onClose={() => setToast(null)} />
      )}
    </div>
  );
}
