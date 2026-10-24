"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AdminChrome } from "@/modules/admin/components/AdminChrome";
import { EmptyState } from "@/components/ui";

const destinations = [
  ["会員", "名前とメールで検索し、他の会員の管理者権限を変更します。", "/console/users", "会員を開く"],
  ["イベント", "催し名・場所・幹事で検索します。下書きと削除済みも含みます。内容は変えません。", "/console/events", "イベントを開く"],
  ["決済", "利用枠の単発と月額を検索します。返金や金額の変更はしません。", "/console/payments", "決済を開く"],
  ["料金", "期間限定の割引と0円販売を設定します。停止しても、購入済みの割引は期間満了まで続きます。", "/console/pricing", "料金を開く"],
] as const;

export default function ConsoleHomePage() {
  const router = useRouter();
  const [name, setName] = useState<string | null>(null);
  const [blocked, setBlocked] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let active = true;
    void fetch("/api/v1/admin/session").then(async (res) => {
      if (!active) return;
      if (res.status === 401) {
        router.replace("/console/login");
        return;
      }
      if (res.status === 403) {
        setBlocked(true);
        setReady(true);
        return;
      }
      if (!res.ok) {
        router.replace("/console/login");
        return;
      }
      const data = (await res.json()) as { user: { name: string } };
      setName(data.user.name);
      setReady(true);
    });
    return () => {
      active = false;
    };
  }, [router]);

  if (blocked) {
    return <EmptyState>このページは利用できません。</EmptyState>;
  }

  if (!ready) {
    return <EmptyState>読み込んでいます</EmptyState>;
  }

  return (
    <AdminChrome>
      <div>
        <h1 className="page-title">管理者ホーム</h1>
        <p className="page-lead">
          {name ? `${name}さん、` : ""}登録会員、イベント、利用枠の決済を確認します。
        </p>
      </div>
      <div className="card-grid">
        {destinations.map(([title, body, href, action]) => (
          <article key={href} className="card">
            <h2 className="card__title">{title}</h2>
            <p className="card__body">{body}</p>
            <p className="hero__actions hero__actions--solo">
              <Link href={href} className="btn btn--primary">
                {action}
              </Link>
            </p>
          </article>
        ))}
      </div>
    </AdminChrome>
  );
}
