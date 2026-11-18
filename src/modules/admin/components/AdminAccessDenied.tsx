"use client";

import Link from "next/link";
import { useEffect } from "react";
import { EmptyState } from "@/components/ui";
import { SITE } from "@/lib/site";
import { invalidateViewer } from "@/lib/viewer-store";

/**
 * 管理コンソールを開いた会員が管理者でなかったときの受け皿。
 *
 * 権限を外された直後は、管理 API が 403 を返す。以前は「このページは利用できません。」を
 * 出すだけだった。管理コンソールは共通ヘッダーを出さないので、そこから主催者・参加者の
 * 画面へ戻る道が無く、行き止まりになっていた。
 *
 * ここでは主催者マイページと参加者ホームへの道を 1 本ずつ置く。会員セッションは
 * そのままなので、ログアウトせずに続けられる。
 */
export function AdminAccessDenied() {
  // 管理コンソールを一度でも開いた端末は、共通ヘッダーの控え（`viewer-store`）が
  // `ADMIN` のまま。一般の画面へ移ると管理者の並びのままになるので、ここで取り直させる。
  useEffect(() => {
    invalidateViewer();
  }, []);

  return (
    <EmptyState as="div">
      <p className="empty__title">このページは利用できません。</p>
      <p className="empty__body">
        管理者権限が外れていると、管理コンソールは開けません。主催者・参加者の画面はそのまま使えます。
      </p>
      <p className="empty__body">
        <Link href={SITE.nav.mypage.href} className="btn btn--primary btn--sm">
          {SITE.nav.mypage.label}へ
        </Link>{" "}
        <Link href={SITE.nav.participantHome.href} className="btn btn--outline btn--sm">
          {SITE.nav.participantHome.label}へ
        </Link>
      </p>
    </EmptyState>
  );
}
