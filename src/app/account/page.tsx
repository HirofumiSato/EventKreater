"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { readProblem } from "@/lib/problem";
import { AccountInfoPanel } from "@/modules/account/components/AccountInfoPanel";
import { PasswordPanel } from "@/modules/account/components/PasswordPanel";
import { PhoneChangePanel } from "@/modules/account/components/PhoneChangePanel";
import { WithdrawPanel } from "@/modules/account/components/WithdrawPanel";
import type { AccountProfile, AccountProfileResponse } from "@/modules/account/types";

/**
 * 会員のアカウント設定。主催者・参加者のどちらも同じ画面を使う。
 * イベントごとの参加者名はここではなく、各イベントの出欠フォームで扱う。
 */
export default function AccountPage() {
  const [profile, setProfile] = useState<AccountProfile | null>(null);
  const [isOrganizer, setIsOrganizer] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    void fetch("/api/v1/user/profile")
      .then(async (res) => {
        if (res.status === 401) {
          window.location.href = "/auth/login?next=/account";
          return null;
        }
        if (!res.ok) throw new Error(await readProblem(res));
        return (await res.json()) as AccountProfileResponse;
      })
      .then((data) => {
        if (!active || !data) return;
        setProfile(data.user);
        setIsOrganizer(data.isOrganizer);
      })
      .catch((cause: unknown) => {
        if (active) setError(cause instanceof Error ? cause.message : "読み込みに失敗しました");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const patchProfile = (next: Partial<AccountProfile>) => {
    setProfile((current) => (current ? { ...current, ...next } : current));
  };

  if (loading) {
    return (
      <div className="page--form stack">
        <p className="help">読み込んでいます...</p>
      </div>
    );
  }

  if (error || !profile) {
    return (
      <div className="page--form stack">
        <h1 className="page-title">アカウント</h1>
        <p className="alert alert--warning">
          {error ?? "会員情報を読み込めませんでした。"}{" "}
          <Link href="/auth/login" className="text-link">
            ログイン
          </Link>
        </p>
      </div>
    );
  }

  return (
    <div className="page--form stack">
      <section className="panel">
        <div>
          <h1 className="page-title">アカウント</h1>
          <p className="page-lead">
            表示名、ログインに使う連絡先、パスワードをここで管理します。主催者・参加者のどちらの立場でも同じ設定を使います。
          </p>
        </div>
        <div className="panel__actions">
          {isOrganizer ? (
            <Link href="/mypage" className="btn btn--outline btn--sm">
              主催者マイページへ
            </Link>
          ) : (
            <Link href="/participant" className="btn btn--outline btn--sm">
              参加者ホームへ
            </Link>
          )}
        </div>
      </section>

      <AccountInfoPanel profile={profile} onChange={patchProfile} />

      <section className="panel">
        <h2 className="panel__title">電話番号</h2>
        <PhoneChangePanel profile={profile} onChange={patchProfile} />
      </section>

      <PasswordPanel profile={profile} onChange={patchProfile} />

      <WithdrawPanel profile={profile} />
    </div>
  );
}
