"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { AdminChrome } from "@/modules/admin/components/AdminChrome";
import { readProblem } from "@/lib/problem";
import { ONE_TIME_PRICE_JPY, SUBSCRIPTION_PRICE_JPY } from "@/modules/billing/lib/plans";
import { roundChargedPrice } from "@/modules/billing/lib/pricing";
import { yenMark } from "@/lib/format";
import { Alert, EmptyState, Field } from "@/components/ui";

interface CampaignRow {
  id: string;
  name: string;
  target: "ONE_TIME" | "SUBSCRIPTION" | "BOTH";
  discountKind: "PERCENT" | "FREE";
  percent: number;
  startsAt: string;
  endsAt: string;
  priority: number;
  isEnabled: boolean;
  status: "SCHEDULED" | "ACTIVE" | "ENDED" | "STOPPED";
  freePerUserLimit: number;
  version: number;
  stoppedAt: string | null;
  createdAt: string;
  updatedAt: string;
  stats: { paidCount: number; revenue: number; discountTotal: number };
}

interface FormValues {
  name: string;
  target: "ONE_TIME" | "SUBSCRIPTION" | "BOTH";
  discountKind: "PERCENT" | "FREE";
  percent: string;
  startsAt: string;
  endsAt: string;
  priority: string;
  freePerUserLimit: string;
  isEnabled: boolean;
}

const TARGET_LABEL = {
  ONE_TIME: "単発のみ",
  SUBSCRIPTION: "月額のみ",
  BOTH: "単発と月額",
} as const;

const STATUS_LABEL = {
  SCHEDULED: "開始前",
  ACTIVE: "実施中",
  ENDED: "終了",
  STOPPED: "停止",
} as const;

function formatWhen(value: string): string {
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function toLocalInput(date: Date): string {
  const jst = new Date(date.getTime() + 9 * 60 * 60 * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${jst.getUTCFullYear()}-${pad(jst.getUTCMonth() + 1)}-${pad(jst.getUTCDate())}T${pad(jst.getUTCHours())}:${pad(jst.getUTCMinutes())}`;
}

function addMonths(date: Date, months: number): Date {
  const next = new Date(date.getTime());
  next.setMonth(next.getMonth() + months);
  return next;
}

function defaults(): FormValues {
  const now = new Date();
  return {
    name: "",
    target: "BOTH",
    discountKind: "PERCENT",
    percent: "30",
    startsAt: toLocalInput(now),
    endsAt: toLocalInput(addMonths(now, 1)),
    priority: "0",
    freePerUserLimit: "1",
    isEnabled: true,
  };
}

function fromRow(row: CampaignRow): FormValues {
  return {
    name: row.name,
    target: row.target,
    discountKind: row.discountKind,
    percent: String(row.percent),
    startsAt: toLocalInput(new Date(row.startsAt)),
    endsAt: toLocalInput(new Date(row.endsAt)),
    priority: String(row.priority),
    freePerUserLimit: String(row.freePerUserLimit),
    isEnabled: row.isEnabled,
  };
}

export default function AdminPricingPage() {
  const router = useRouter();
  const [campaigns, setCampaigns] = useState<CampaignRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [blocked, setBlocked] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormValues>(defaults);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const res = await fetch("/api/v1/admin/pricing-campaigns");
    if (res.status === 401) {
      router.replace("/console/login");
      return;
    }
    if (res.status === 403) {
      setBlocked(true);
      setCampaigns([]);
      setLoading(false);
      return;
    }
    if (!res.ok) {
      setError(await readProblem(res));
      setLoading(false);
      return;
    }
    const data = (await res.json()) as { campaigns: CampaignRow[] };
    setCampaigns(data.campaigns);
    setLoading(false);
  }, [router]);

  useEffect(() => {
    void load();
  }, [load]);

  const startCreate = () => {
    setEditingId(null);
    setForm(defaults());
    setFormOpen(true);
    setError(null);
  };

  const startEdit = (row: CampaignRow) => {
    setEditingId(row.id);
    setForm(fromRow(row));
    setFormOpen(true);
    setError(null);
  };

  const percentValue = form.discountKind === "FREE" ? 100 : Number(form.percent);
  const previewOneTime = Number.isFinite(percentValue)
    ? roundChargedPrice(ONE_TIME_PRICE_JPY, percentValue)
    : ONE_TIME_PRICE_JPY;
  const previewSubscription = Number.isFinite(percentValue)
    ? roundChargedPrice(SUBSCRIPTION_PRICE_JPY, percentValue)
    : SUBSCRIPTION_PRICE_JPY;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const payload = {
        name: form.name,
        target: form.target,
        discountKind: form.discountKind,
        percent: form.discountKind === "FREE" ? 100 : Number(form.percent),
        startsAt: form.startsAt,
        endsAt: form.endsAt,
        priority: Number(form.priority),
        freePerUserLimit: Number(form.freePerUserLimit),
        isEnabled: form.isEnabled,
      };
      const res = await fetch(
        editingId ? `/api/v1/admin/pricing-campaigns/${editingId}` : "/api/v1/admin/pricing-campaigns",
        {
          method: editingId ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
      );
      if (!res.ok) throw new Error(await readProblem(res));
      setToast(editingId ? "キャンペーンを更新しました" : "キャンペーンを作成しました");
      setFormOpen(false);
      setEditingId(null);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "保存に失敗しました");
    } finally {
      setSaving(false);
    }
  };

  const stop = async (row: CampaignRow) => {
    if (!window.confirm(`「${row.name}」を停止します。新規の申込だけが止まり、購入済みの割引は期間満了まで続きます。`)) {
      return;
    }
    setBusyId(row.id);
    setError(null);
    try {
      const res = await fetch(`/api/v1/admin/pricing-campaigns/${row.id}/stop`, { method: "POST" });
      if (!res.ok) throw new Error(await readProblem(res));
      setToast("キャンペーンを停止しました");
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "停止に失敗しました");
    } finally {
      setBusyId(null);
    }
  };

  if (blocked) {
    return <EmptyState>このページは利用できません。</EmptyState>;
  }

  return (
    <AdminChrome>
      <div>
        <h1 className="page-title">料金キャンペーン</h1>
        <p className="page-lead">
          単発チケットと月額プランの販売価格を、期間と対象を決めて割り引きます。定価は変更しません。
          0円の月額は無料期間の終了後に自動で有料へ切り替わります。
        </p>
      </div>

      {toast && (
        <Alert
          tone="success"
          as="div"
          style={{ display: "flex", justifyContent: "space-between", gap: "1rem" }}
        >
          <p>{toast}</p>
          <button type="button" className="btn btn--ghost btn--sm" onClick={() => setToast(null)}>
            閉じる
          </button>
        </Alert>
      )}
      {error ? <Alert tone="error">{error}</Alert> : null}

      <div className="btn-row">
        <button type="button" className="btn btn--primary" onClick={startCreate}>
          新しいキャンペーン
        </button>
        <Link href="/service" className="btn btn--outline" target="_blank">
          公開中の料金を見る
        </Link>
      </div>

      {formOpen && (
        <form className="form panel" onSubmit={submit}>
          <h2 className="panel__title">{editingId ? "キャンペーンを編集" : "キャンペーンを作成"}</h2>
          <Field label="名前" htmlFor="campaign-name">
            <input
              id="campaign-name"
              className="input"
              value={form.name}
              onChange={(event) => setForm({ ...form, name: event.target.value })}
              placeholder="例: 秋のスタート応援"
              maxLength={100}
              required
            />
          </Field>
          <Field label="対象" htmlFor="campaign-target">
            <select
              id="campaign-target"
              className="input"
              value={form.target}
              onChange={(event) => setForm({ ...form, target: event.target.value as FormValues["target"] })}
            >
              <option value="BOTH">単発と月額</option>
              <option value="ONE_TIME">単発のみ</option>
              <option value="SUBSCRIPTION">月額のみ</option>
            </select>
          </Field>
          <Field label="割引の種類" htmlFor="campaign-kind">
            <select
              id="campaign-kind"
              className="input"
              value={form.discountKind}
              onChange={(event) => setForm({ ...form, discountKind: event.target.value as FormValues["discountKind"] })}
            >
              <option value="PERCENT">割合で割引</option>
              <option value="FREE">無料（0円）</option>
            </select>
          </Field>
          {form.discountKind === "PERCENT" && (
            <Field label="割引率（%）" htmlFor="campaign-percent">
              <input
                id="campaign-percent"
                className="input"
                type="number"
                min={1}
                max={99}
                value={form.percent}
                onChange={(event) => setForm({ ...form, percent: event.target.value })}
                required
              />
              <p className="help">
                10円単位で切り上げ、最低10円を請求します。1円も安くならない割引は保存できません。
              </p>
            </Field>
          )}
          <Field label="開始日時（JST）" htmlFor="campaign-start">
            <input
              id="campaign-start"
              className="input"
              type="datetime-local"
              value={form.startsAt}
              onChange={(event) => setForm({ ...form, startsAt: event.target.value })}
              required
            />
          </Field>
          <Field label="終了日時（JST）" htmlFor="campaign-end">
            <input
              id="campaign-end"
              className="input"
              type="datetime-local"
              value={form.endsAt}
              onChange={(event) => setForm({ ...form, endsAt: event.target.value })}
              required
            />
            <p className="help">最大12か月まで。月額の割引は、加入から終了日までを1か月単位で切り上げた月数ぶん続きます。</p>
          </Field>
          <Field label="優先度" htmlFor="campaign-priority">
            <input
              id="campaign-priority"
              className="input"
              type="number"
              min={0}
              max={1000}
              value={form.priority}
              onChange={(event) => setForm({ ...form, priority: event.target.value })}
            />
            <p className="help">重なったときに大きい方が適用されます。同じなら新しい方が勝ちます。</p>
          </Field>
          <Field label="0円チケットを1人が受け取れる回数" htmlFor="campaign-limit">
            <input
              id="campaign-limit"
              className="input"
              type="number"
              min={1}
              max={10}
              value={form.freePerUserLimit}
              onChange={(event) => setForm({ ...form, freePerUserLimit: event.target.value })}
            />
          </Field>
          <label className="label" style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
            <input
              type="checkbox"
              checked={form.isEnabled}
              onChange={(event) => setForm({ ...form, isEnabled: event.target.checked })}
            />
            すぐに有効にする
          </label>

          <Alert tone="info" as="div">
            <p>
              販売価格のプレビュー: 単発 {yenMark(previewOneTime)}
              {previewOneTime !== ONE_TIME_PRICE_JPY ? `（定価 ${yenMark(ONE_TIME_PRICE_JPY)}）` : ""} / 月額{" "}
              {yenMark(previewSubscription)}
              {previewSubscription !== SUBSCRIPTION_PRICE_JPY ? `（定価 ${yenMark(SUBSCRIPTION_PRICE_JPY)}）` : ""}
            </p>
          </Alert>

          <div className="btn-row">
            <button type="submit" className="btn btn--primary" disabled={saving}>
              {saving ? "保存しています" : editingId ? "更新する" : "作成する"}
            </button>
            <button
              type="button"
              className="btn btn--ghost"
              disabled={saving}
              onClick={() => {
                setFormOpen(false);
                setEditingId(null);
              }}
            >
              キャンセル
            </button>
          </div>
        </form>
      )}

      <div className="table-card">
        <div className="table-card__head">
          <h2 className="table-card__title">キャンペーン一覧</h2>
        </div>
        <div className="table-card__scroll">
          <table className="data">
            <thead>
              <tr>
                <th>名前</th>
                <th>対象</th>
                <th>割引</th>
                <th>期間</th>
                <th>状態</th>
                <th>実績</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td className="data__empty" colSpan={7}>
                    読み込んでいます
                  </td>
                </tr>
              ) : campaigns.length === 0 ? (
                <tr>
                  <td className="data__empty" colSpan={7}>
                    キャンペーンはまだありません。定価で販売しています。
                  </td>
                </tr>
              ) : (
                campaigns.map((row) => (
                  <tr key={row.id}>
                    <td>
                      {row.name}
                      <div className="data__muted">優先度 {row.priority} ・ 版 {row.version}</div>
                    </td>
                    <td>{TARGET_LABEL[row.target]}</td>
                    <td>
                      {row.discountKind === "FREE" ? "無料（0円）" : `${row.percent}%OFF`}
                      <div className="data__muted">
                        {row.discountKind === "PERCENT"
                          ? `単発 ${yenMark(roundChargedPrice(ONE_TIME_PRICE_JPY, row.percent))} / 月額 ${yenMark(
                              roundChargedPrice(SUBSCRIPTION_PRICE_JPY, row.percent),
                            )}`
                          : row.target === "SUBSCRIPTION"
                            ? "月額は初回0円のクーポンで対応"
                            : row.target === "ONE_TIME"
                              ? "0円チケットは付与で対応"
                              : "単発は付与、月額は0円クーポンで対応"}
                      </div>
                    </td>
                    <td className="data__muted">
                      {formatWhen(row.startsAt)}
                      <div>〜 {formatWhen(row.endsAt)}</div>
                    </td>
                    <td>{STATUS_LABEL[row.status]}</td>
                    <td className="data__muted">
                      {row.stats.paidCount}件
                      <div>売上 {yenMark(row.stats.revenue)}</div>
                      <div>割引 {yenMark(row.stats.discountTotal)}</div>
                    </td>
                    <td>
                      <div className="btn-row">
                        <button
                          type="button"
                          className="btn btn--outline btn--sm"
                          onClick={() => startEdit(row)}
                          disabled={Boolean(row.stoppedAt)}
                        >
                          編集
                        </button>
                        <button
                          type="button"
                          className="btn btn--danger btn--sm"
                          onClick={() => void stop(row)}
                          disabled={Boolean(row.stoppedAt) || busyId === row.id}
                        >
                          {busyId === row.id ? "停止中" : "停止"}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <p className="help">
        停止しても、すでに申し込んだ利用者の割引は Stripe 側の期間が切れるまで続きます。
        価格の変更は新しい版として扱い、既存の購入者には影響しません。
      </p>
    </AdminChrome>
  );
}
