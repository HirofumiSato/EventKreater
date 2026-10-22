"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { readProblem } from "@/lib/problem";
import { RAIN_POLICY_LABELS, type RainPolicy } from "@/modules/events/types";

interface Preview {
  event: {
    id: string;
    title: string;
    schedules: { id: string; eventDate: string; eventTime: string }[];
    pricePlans: { id: string; name: string; price: string }[];
    location: string;
    rainPolicy: RainPolicy;
    organizer: { ownerName: string | null; coHostCount: number };
  };
  invitation: { expiresAt: string };
  loggedIn: boolean;
}

export default function InvitationPage({ params }: { params: { code: string } }) {
  const router = useRouter();
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const loginHref = `/auth/register?next=${encodeURIComponent(`/invitations/${params.code}`)}`;

  useEffect(() => {
    let active = true;
    const load = async () => {
      const res = await fetch(`/api/v1/invitations/${params.code}`);
      if (!res.ok) throw new Error(await readProblem(res));
      const body = (await res.json()) as Preview;
      if (active) setPreview(body);
    };
    void load().catch((cause: unknown) => {
      if (active) setError(cause instanceof Error ? cause.message : "招待を確認できません");
    });
    return () => {
      active = false;
    };
  }, [params.code]);

  const accept = async () => {
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/invitations/${params.code}`, { method: "POST" });
      if (!res.ok) throw new Error(await readProblem(res));
      const result = (await res.json()) as { manageUrl: string };
      router.push(result.manageUrl);
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "受諾に失敗しました");
      setPending(false);
    }
  };

  if (error && !preview) {
    return (
      <div className="page--form stack">
        <h1 className="page-title">共同主催者の招待</h1>
        <p className="page-lead">招待を表示できません。</p>
        <p className="alert alert--error">{error}</p>
      </div>
    );
  }
  if (!preview) {
    return (
      <p className="loading">
        <span className="spinner" aria-hidden="true" />
        招待を確認しています
      </p>
    );
  }

  return (
    <div className="page--form stack">
      <div>
        <h1 className="page-title">共同主催者の招待</h1>
        <p className="page-lead">{preview.event.title}</p>
      </div>
      <dl className="meta-list">
        <div>
          <dt>主催</dt>
          <dd>{preview.event.organizer.ownerName ?? "主催者"}</dd>
        </div>
        <div>
          <dt>開催</dt>
          <dd>
            {preview.event.schedules.map((row) => `${row.eventDate} ${row.eventTime}`).join("、")}
          </dd>
        </div>
        <div>
          <dt>場所</dt>
          <dd>{preview.event.location}</dd>
        </div>
        <div>
          <dt>費用</dt>
          <dd>{preview.event.pricePlans.map((row) => `${row.name} ${row.price}`).join("、")}</dd>
        </div>
        <div>
          <dt>雨天</dt>
          <dd>{RAIN_POLICY_LABELS[preview.event.rainPolicy]}</dd>
        </div>
      </dl>
      <p className="help">有効期限 {new Date(preview.invitation.expiresAt).toLocaleString("ja-JP")}</p>
      {error && <p className="alert alert--error">{error}</p>}
      {preview.loggedIn ? (
        <button type="button" disabled={pending} onClick={() => void accept()} className="btn btn--primary btn--block">
          {pending ? "参加処理中..." : "共同主催者として参加する"}
        </button>
      ) : (
        <div className="stack">
          <p className="help">
            共同主催者として参加するには会員登録が必要です。登録すると、このイベントの編集と名簿を分担できます。利用枠は消費しません。
          </p>
          <Link href={loginHref} className="btn btn--primary btn--block">
            会員登録して受諾する
          </Link>
          <Link
            href={`/auth/register?mode=login&next=${encodeURIComponent(`/invitations/${params.code}`)}`}
            className="btn btn--outline btn--block"
          >
            すでに会員の方はログイン
          </Link>
        </div>
      )}
    </div>
  );
}
