"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowDownNarrowWide, ArrowUpNarrowWide } from "lucide-react";
import { EventCard } from "@/modules/events/components/EventCard";
import { EventLifecycleModal } from "@/modules/organizers/components/EventLifecycleModal";
import { QuotaStatusBanner } from "@/modules/billing/components/QuotaStatusBanner";
import { VerifyPaymentBanner } from "@/modules/billing/components/VerifyPaymentBanner";
import { PricingModal } from "@/modules/billing/components/PricingModal";
import { Toast } from "@/components/common/Toast";
import { useEventQuota } from "@/modules/billing/hooks/useEventQuota";
import { readProblem } from "@/lib/problem";
import { phoneVerifyUrl } from "@/lib/auth-links";
import { SITE } from "@/lib/site";
import type { OrganizerEvent } from "@/modules/events/types";
import {
  activeFilterCount,
  clampPage,
  DEFAULT_ORGANIZER_FILTER,
  DEFAULT_ORGANIZER_SORT,
  filterOrganizerEvents,
  hasActiveFilter,
  pageCountOf,
  pageRangeLabel,
  paginate,
  sortOrganizerEvents,
  todayInTokyo,
  type OrganizerSortOrder,
  type OrganizerStatusFilter,
} from "@/modules/events/lib/event-filters";
import { Alert, Dialog, EmptyState, Field, Loading, PageHeader, Section, SectionHead } from "@/components/ui";

type LifecycleAction = "close" | "reopen" | "delete";

/** モーダルの中だけで動かす控え。閉じたときに捨てれば、一覧は元の条件のまま。 */
type FilterDraft = { status: OrganizerStatusFilter; from: string; to: string };

function OrganizerEventsScreen() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const quotaState = useEventQuota();
  const [events, setEvents] = useState<OrganizerEvent[]>([]);
  // 下書きは専用の一覧（/organizer/events/drafts）へ分ける。出欠の統計が常に 0 のため。
  const [draftCount, setDraftCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // 絞り込みとページ割りは画面側で持つ。一覧 API は全件を返し（マイページと
  // カレンダーが全件前提）、催しは年を跨いで溜まり続けるため。
  const [statusFilter, setStatusFilter] = useState<OrganizerStatusFilter>("ALL");
  const [excludePast, setExcludePast] = useState(false);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  // 状態と開催日は、スマホではモーダルに畳む。開いた時点の確定値を控えへ写し、
  // 「この条件で絞り込む」を押すまで一覧は動かさない（背景を押せば元の条件に戻る）。
  const [filterOpen, setFilterOpen] = useState(false);
  const [draftFilter, setDraftFilter] = useState<FilterDraft>({ status: "ALL", from: "", to: "" });
  // 並べ替えは絞り込みとは別に持つ。「条件を戻す」でも触らない（見たい順は残す）。
  const [sortOrder, setSortOrder] = useState<OrganizerSortOrder>(DEFAULT_ORGANIZER_SORT);
  const [page, setPage] = useState(1);
  const today = todayInTokyo();

  const filter = useMemo(
    () => ({ ...DEFAULT_ORGANIZER_FILTER, status: statusFilter, excludePast, from: dateFrom, to: dateTo }),
    [statusFilter, excludePast, dateFrom, dateTo],
  );
  const filtered = useMemo(
    () => sortOrganizerEvents(filterOrganizerEvents(events, filter, today), sortOrder),
    [events, filter, today, sortOrder],
  );
  const currentPage = clampPage(page, filtered.length);
  const totalPages = pageCountOf(filtered.length);
  const visible = paginate(filtered, currentPage);

  // 条件か並び順を変えたら 1 ページ目へ戻す。3 ページ目を見たまま絞ると、
  // 並べ替えで別の催しが着地して、見ていた催しを見失う。
  useEffect(() => {
    setPage(1);
  }, [statusFilter, excludePast, dateFrom, dateTo, sortOrder]);

  const load = useCallback(async () => {
    const res = await fetch("/api/v1/organizer/events");
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
    // 下書きは別の一覧へ分ける。並びは API のまま（作った新しい順）で変えない。
    setEvents(data.events.filter((event) => event.status !== "DRAFT"));
    setDraftCount(data.events.filter((event) => event.status === "DRAFT").length);
    setError(null);
  }, []);

  useEffect(() => {
    void load().finally(() => setLoading(false));
  }, [load]);

  // 会員登録から戻ってきたときの完了トースト。URL からは印を消して、再読み込みで繰り返さない。
  useEffect(() => {
    if (searchParams.get("registered") !== "1") return;
    setToast("会員登録が完了しました。公開したイベントは一覧から管理できます。");
    router.replace("/organizer/events");
  }, [searchParams, router]);

  const cloneEvent = async (id: string) => {
    setBusyId(id);
    try {
      const res = await fetch(`/api/v1/organizer/events/${id}/clone`, { method: "POST" });
      if (res.status === 402) {
        quotaState.openPricingModal({ returnTo: "/organizer/events" });
        return;
      }
      if (res.status === 403) {
        const problem = (await res.json().catch(() => ({}))) as { error?: string; detail?: string };
        if (problem.error === "PHONE_REQUIRED") {
          window.location.href = phoneVerifyUrl("/organizer/events");
          return;
        }
        throw new Error(problem.detail || "複製に失敗しました");
      }
      if (!res.ok) throw new Error(await readProblem(res));
      const data = (await res.json()) as { event: { id: string } };
      router.push(`/organizer/events/${data.event.id}/edit`);
    } catch (cause) {
      setToast(cause instanceof Error ? cause.message : "複製に失敗しました");
    } finally {
      setBusyId(null);
      void quotaState.refreshQuota();
    }
  };

  const runLifecycle = async (id: string, action: LifecycleAction) => {
    setBusyId(id);
    try {
      const res = await fetch(`/api/v1/organizer/events/${id}/lifecycle`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      if (!res.ok) throw new Error(await readProblem(res));
      setToast(
        action === "delete"
          ? "イベントを削除しました"
          : action === "close"
            ? "公開を一時停止しました。告知ページは残っています。"
            : "公開を再開しました。また出欠を受け付けます。",
      );
      setDeletingId(null);
      await load();
    } catch (cause) {
      setToast(cause instanceof Error ? cause.message : "操作に失敗しました");
    } finally {
      setBusyId(null);
    }
  };

  const resetFilter = () => {
    setStatusFilter("ALL");
    setExcludePast(false);
    setDateFrom("");
    setDateTo("");
  };

  const openFilterDialog = () => {
    setDraftFilter({ status: statusFilter, from: dateFrom, to: dateTo });
    setFilterOpen(true);
  };

  const applyFilterDialog = () => {
    setStatusFilter(draftFilter.status);
    setDateFrom(draftFilter.from);
    setDateTo(draftFilter.to);
    setFilterOpen(false);
  };

  // ボタンに添える件数。外に出している「過去の催しを除く」は数えない。
  const filterCount = activeFilterCount({ ...DEFAULT_ORGANIZER_FILTER, status: statusFilter, from: dateFrom, to: dateTo });

  // 並べ替えはアイコンだけなので、押すと何が起きるかを読み上げとツールチップで補う。
  // いまの並び（昇順か降順か）はアイコンの向きで示す。
  const sortLabel = sortOrder === "asc" ? "開催日の新しい順に並べ替える" : "開催日の古い順に並べ替える";

  const publishedCount = events.filter((event) => event.status === "PUBLISHED").length;
  const closedCount = events.filter((event) => event.status === "CLOSED").length;

  return (
    <div className="stack has-action-dock">
      <PageHeader title="主催イベント一覧" />

      <QuotaStatusBanner
        quota={quotaState.quota}
        onOpenPricing={() => quotaState.openPricingModal({ returnTo: "/organizer/events" })}
      />
      <VerifyPaymentBanner
        onVerified={() => {
          void quotaState.refreshQuota();
          void load();
        }}
      />

      {loading && (
        <Loading>
          読み込んでいます
        </Loading>
      )}
      {error && (
        <Alert tone="warning">
          {error}{" "}
          <Link href={SITE.nav.organizerLogin.href} className="text-link">
            {SITE.nav.organizerLogin.label}
          </Link>
        </Alert>
      )}

      {!loading && !error && (
        <div className="stat-grid">
          <div className="stat">
            <p className="stat__label">公開中</p>
            <p className="stat__value">
              {publishedCount}
              <span className="stat__unit">件</span>
            </p>
          </div>
          <div className="stat">
            <p className="stat__label">受付停止</p>
            <p className="stat__value">
              {closedCount}
              <span className="stat__unit">件</span>
            </p>
          </div>
        </div>
      )}

      <Section className="section--tight">
        <SectionHead title="一覧" />

        {/* 溜まった催しから目当てを探すための 3 つ。状態・過去・開催日で絞る。
            640px 未満では状態と開催日をモーダルへ畳み、一覧の場所を空ける。
            過去の除外だけは外に残し、並び順（開催日の昇順降順）も 1 押しで切り替える。 */}
        <div className="list-filters">
          <button
            type="button"
            className="btn btn--outline btn--sm list-filters__open"
            aria-haspopup="dialog"
            aria-expanded={filterOpen}
            onClick={openFilterDialog}
          >
            絞り込む{filterCount > 0 ? `（${filterCount}）` : ""}
          </button>
          <label className="list-filters__field" htmlFor="organizer-filter-status">
            <span className="list-filters__label">状態</span>
            <select
              id="organizer-filter-status"
              className="select"
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.currentTarget.value as OrganizerStatusFilter)}
            >
              <option value="ALL">すべて</option>
              <option value="PUBLISHED">公開中のみ</option>
              <option value="CLOSED">受付停止のみ</option>
            </select>
          </label>
          <label className="list-filters__field" htmlFor="organizer-filter-from">
            <span className="list-filters__label">開始日</span>
            <input
              id="organizer-filter-from"
              type="date"
              className="input"
              value={dateFrom}
              max={dateTo || undefined}
              onChange={(event) => setDateFrom(event.currentTarget.value)}
            />
          </label>
          <label className="list-filters__field" htmlFor="organizer-filter-to">
            <span className="list-filters__label">終了日</span>
            <input
              id="organizer-filter-to"
              type="date"
              className="input"
              value={dateTo}
              min={dateFrom || undefined}
              onChange={(event) => setDateTo(event.currentTarget.value)}
            />
          </label>
          {/* 開催日の昇順降順。スマホでは「絞り込む」の隣に並び、640px 以上では
              日付の入力の後ろに付く。DOM の順のまま置けるので、読み上げと焦点の順も変わらない。 */}
          <button
            type="button"
            className="btn btn--outline btn--sm list-filters__sort"
            aria-label={sortLabel}
            title={sortLabel}
            onClick={() => setSortOrder((current) => (current === "asc" ? "desc" : "asc"))}
          >
            {sortOrder === "asc" ? (
              <ArrowUpNarrowWide className="icon" aria-hidden="true" />
            ) : (
              <ArrowDownNarrowWide className="icon" aria-hidden="true" />
            )}
          </button>
          <label className="check list-filters__check">
            <input
              type="checkbox"
              checked={excludePast}
              onChange={(event) => setExcludePast(event.currentTarget.checked)}
            />
            <span>過去の催しを除く</span>
          </label>
        </div>

        {!loading && !error && events.length === 0 && (
          <EmptyState as="div">
            <p className="empty__title">
              {draftCount > 0
                ? `公開中・受付停止の催しはありません。下書きが${draftCount}件あります。`
                : "まだ主催イベントがありません。"}
            </p>
            {draftCount > 0 && (
              <p className="empty__body">
                内容を確かめてから公開できます。{" "}
                <Link href="/organizer/events/drafts" className="text-link">
                  下書き一覧を開く
                </Link>
              </p>
            )}
          </EmptyState>
        )}

        {!loading && !error && events.length > 0 && filtered.length === 0 && (
          <EmptyState as="div">
            <p className="empty__title">条件に合う催しはありません。</p>
            <p className="empty__body">
              状態や開催日の範囲を広げると見つかります。{" "}
              <button type="button" className="text-link" onClick={resetFilter}>
                条件を戻す
              </button>
            </p>
          </EmptyState>
        )}

        <div className="event-card-grid">
          {visible.map((event) => (
            <EventCard
              key={event.id}
              event={event}
              busy={busyId === event.id}
              onClone={() => void cloneEvent(event.id)}
              onStop={() => void runLifecycle(event.id, "close")}
              onResume={() => void runLifecycle(event.id, "reopen")}
              onDelete={() => setDeletingId(event.id)}
            />
          ))}
        </div>

        {filtered.length > 0 && (
          <div className="pager">
            <p className="pager__status">{pageRangeLabel(filtered.length, currentPage)}</p>
            {totalPages > 1 && (
              <div className="pager__buttons">
                <button
                  type="button"
                  className="btn btn--outline btn--sm"
                  disabled={currentPage <= 1}
                  onClick={() => setPage(currentPage - 1)}
                >
                  前へ
                </button>
                <span className="pager__count">
                  {currentPage} / {totalPages}
                </span>
                <button
                  type="button"
                  className="btn btn--outline btn--sm"
                  disabled={currentPage >= totalPages}
                  onClick={() => setPage(currentPage + 1)}
                >
                  次へ
                </button>
              </div>
            )}
          </div>
        )}
      </Section>

      {/* スマホの絞り込み。640px 以上ではインラインの入力が出るので、このモーダルは開かない
          （開いたまま幅を広げたときだけ二重に見えるが、条件は同じなので実害は無い）。 */}
      {filterOpen && (
        <Dialog
          title="絞り込む"
          titleId="organizer-filter-title"
          onClose={() => setFilterOpen(false)}
          closeLabel="絞り込みを閉じる"
          actions={
            <>
              <button
                type="button"
                className="btn btn--primary btn--block"
                onClick={applyFilterDialog}
              >
                この条件で絞り込む
              </button>
              <button
                type="button"
                className="btn btn--ghost btn--block"
                onClick={() => setDraftFilter({ status: "ALL", from: "", to: "" })}
              >
                条件を戻す
              </button>
            </>
          }
        >
          <div className="filter-dialog">
            <Field label="状態" htmlFor="organizer-filter-status-modal">
              <select
                id="organizer-filter-status-modal"
                className="select"
                value={draftFilter.status}
                onChange={(event) => {
                  // 値を先に取り出す。更新関数は描画のときに走るので、
                  // その時点の `currentTarget` は null になっている。
                  const status = event.currentTarget.value as OrganizerStatusFilter;
                  setDraftFilter((current) => ({ ...current, status }));
                }}
              >
                <option value="ALL">すべて</option>
                <option value="PUBLISHED">公開中のみ</option>
                <option value="CLOSED">受付停止のみ</option>
              </select>
            </Field>
            <Field label="開始日" htmlFor="organizer-filter-from-modal">
              <input
                id="organizer-filter-from-modal"
                type="date"
                className="input"
                value={draftFilter.from}
                max={draftFilter.to || undefined}
                onChange={(event) => {
                  const from = event.currentTarget.value;
                  setDraftFilter((current) => ({ ...current, from }));
                }}
              />
            </Field>
            <Field label="終了日" htmlFor="organizer-filter-to-modal">
              <input
                id="organizer-filter-to-modal"
                type="date"
                className="input"
                value={draftFilter.to}
                min={draftFilter.from || undefined}
                onChange={(event) => {
                  const to = event.currentTarget.value;
                  setDraftFilter((current) => ({ ...current, to }));
                }}
              />
            </Field>
            <p className="help">開催日が範囲に入る催しだけを出します。「過去の催しを除く」は一覧の上で切り替えます。</p>
          </div>
        </Dialog>
      )}

      {/* 一覧の主要な操作は、どこまでスクロールしても押せるよう画面下に固定する。
          上に置くと、件数が増えたときに最初の 1 画面を操作だけが占める。 */}
      <div className="action-dock">
        <div className="action-dock__inner">
          <Link href="/organizer/events/drafts" className="btn btn--outline btn--sm">
            下書き一覧{draftCount > 0 ? `（${draftCount}）` : ""}
          </Link>
          <Link href={SITE.nav.createEvent.href} className="btn btn--primary btn--sm">
            イベント新規作成
          </Link>
        </div>
      </div>

      <PricingModal
        isOpen={quotaState.isPricingModalOpen}
        onClose={quotaState.closePricingModal}
        onSelectOneTime={quotaState.startOneTimeCheckout}
        onSelectSubscription={quotaState.startSubscriptionCheckout}
        quotes={quotaState.quota?.pricing ?? null}
        freeGrantRemaining={quotaState.quota?.freeGrantRemaining}
        currentPlan={quotaState.quota?.subscriptionPlan}
        context="list"
        onGranted={() => setToast("0円チケットを1回分受け取りました。もう一度「コピー作成」を押してください。")}
      />
      {deletingId && (
        <EventLifecycleModal
          title={events.find((event) => event.id === deletingId)?.title ?? "イベント"}
          status={events.find((event) => event.id === deletingId)?.status ?? "PUBLISHED"}
          busy={busyId === deletingId}
          onClose={() => setDeletingId(null)}
          onDelete={() => void runLifecycle(deletingId, "delete")}
        />
      )}
      {toast && (
        <Toast
          message={toast}
          tone={toast.includes("失敗") ? "error" : "success"}
          onClose={() => setToast(null)}
        />
      )}
    </div>
  );
}

export default function OrganizerEventsPage() {
  return (
    <Suspense
      fallback={
        <Loading>
          読み込んでいます
        </Loading>
      }
    >
      <OrganizerEventsScreen />
    </Suspense>
  );
}
