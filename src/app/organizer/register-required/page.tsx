"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { isEventId } from "@/lib/ids";

/**
 * 公開直後の案内ページの状態。
 * 幹事の端末（ゲスト Cookie）で開いたときだけ、登録の案内を出す。
 * 登録済みの幹事は管理画面へ返し、第三者・不正な ID には案内を出さない。
 */
type AlertState =
  | { kind: "loading" }
  | { kind: "guest"; title: string | null }
  | { kind: "registered" }
  | { kind: "forbidden"; title: string | null }
  | { kind: "not-found" };

/**
 * 未登録のままイベントを公開した直後に出す案内。
 * イベントは公開されたまま残る。出欠の確認・リマインド・領収書・共同幹事の招待は
 * 会員登録が要るので、まずこの端末で共有 URL を配れるようにする。
 */
function RegisterRequiredScreen() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const rawEventId = searchParams.get("eventId");
  // パスを組み立てる前に形を確かめる。幹事向け API は権限を先に見るので、不正な ID の切り分けに使う。
  const eventId = isEventId(rawEventId) ? rawEventId : null;
  const [state, setState] = useState<AlertState>({ kind: "loading" });
  const [shareUrl, setShareUrl] = useState("");
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  const copyTimer = useRef<number | null>(null);
  const manualInput = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!eventId) return;
    setShareUrl(`${window.location.origin}/events/${eventId}`);
    let active = true;

    const load = async () => {
      try {
        // 幹事の端末でだけ読める API。登録済みかどうかもここで分かる。
        const organizer = await fetch(`/api/v1/organizer/events/${eventId}`, { cache: "no-store" });
        if (organizer.ok) {
          const body = (await organizer.json()) as {
            event?: { title?: string };
            registered?: boolean;
          };
          if (!active) return;
          if (body.registered) {
            setState({ kind: "registered" });
            return;
          }
          setState({ kind: "guest", title: body.event?.title ?? null });
          return;
        }

        // 幹事でない（別端末・第三者）。催し名だけは公開ページから取れるので、案内文に使う。
        const publicRes = await fetch(`/api/v1/public/events/${eventId}`, { cache: "no-store" });
        if (!active) return;
        if (publicRes.ok) {
          const body = (await publicRes.json()) as { title?: string };
          setState({ kind: "forbidden", title: body.title ?? null });
          return;
        }
        setState(publicRes.status === 404 ? { kind: "not-found" } : { kind: "forbidden", title: null });
      } catch {
        // 通信に失敗しても、共有 URL は配れる状態にしておく。
        if (active) setState({ kind: "guest", title: null });
      }
    };

    void load();
    return () => {
      active = false;
    };
  }, [eventId]);

  // 登録済みの幹事には、この画面ではなく管理画面を渡す。
  useEffect(() => {
    if (state.kind === "registered" && eventId) {
      router.replace(`/organizer/events/${eventId}`);
    }
  }, [state.kind, eventId, router]);

  useEffect(() => {
    return () => {
      if (copyTimer.current !== null) window.clearTimeout(copyTimer.current);
    };
  }, []);

  const copyShareUrl = async () => {
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopyFailed(false);
      setCopied(true);
      if (copyTimer.current !== null) window.clearTimeout(copyTimer.current);
      copyTimer.current = window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // http の公開や権限拒否では失敗する。手動でコピーできる入力欄に切り替える。
      setCopied(false);
      setCopyFailed(true);
      window.requestAnimationFrame(() => manualInput.current?.select());
    }
  };

  if (!rawEventId) {
    return (
      <div className="page--form stack">
        <h1 className="page-title">イベントを公開しました</h1>
        <p className="alert alert--warning">
          このページは公開直後の幹事向けです。続けて出欠を確認するには、会員登録をしてください。
        </p>
        <Link href="/organizer/events" className="btn btn--primary btn--block">
          主催イベント一覧へ
        </Link>
      </div>
    );
  }

  if (!eventId || state.kind === "not-found") {
    return (
      <div className="page--form stack">
        <h1 className="page-title">イベントが見つかりません</h1>
        <p className="page-lead">
          このイベントは削除されたか、URL が正しくありません。共有された URL をもう一度確かめてください。
        </p>
        <Link href="/" className="btn btn--outline btn--block">
          トップへ
        </Link>
      </div>
    );
  }

  if (state.kind === "loading" || state.kind === "registered") {
    return (
      <p className="loading">
        <span className="spinner" aria-hidden="true" />
        読み込んでいます
      </p>
    );
  }

  if (state.kind === "forbidden") {
    return (
      <div className="page--form stack">
        <div>
          <h1 className="page-title">このページは公開直後の幹事向けです</h1>
          <p className="page-lead">
            {state.title
              ? `「${state.title}」は公開されています。参加者は共有 URL から出欠を回答できます。`
              : "イベントは公開されています。参加者は共有 URL から出欠を回答できます。"}
          </p>
        </div>
        <a href={shareUrl} className="btn btn--primary btn--block" target="_blank" rel="noreferrer">
          公開ページを開く
        </a>
        <Link href="/" className="btn btn--outline btn--block">
          トップへ
        </Link>
      </div>
    );
  }

  const nextPath = `/organizer/events/${eventId}`;

  return (
    <div className="page--form stack">
      <div>
        <h1 className="page-title">イベントを公開しました</h1>
        <p className="page-lead">
          {`${state.title ? `「${state.title}」は` : "イベントは"}公開されたまま残ります。参加者に共有する URL を配ってください。`}
        </p>
      </div>

      <section className="card card--padded stack">
        <div>
          <p className="label">参加者に共有する URL</p>
          <p className="quote">{shareUrl}</p>
        </div>
        <button type="button" className="btn btn--outline btn--block" onClick={() => void copyShareUrl()}>
          {copied ? "コピーしました" : "共有 URL をコピー"}
        </button>
        <p className="help" aria-live="polite">
          {copyFailed ? "コピーできませんでした。下の URL を選んでコピーしてください。" : ""}
        </p>
        {copyFailed && (
          <input
            ref={manualInput}
            className="input"
            readOnly
            value={shareUrl}
            aria-label="共有 URL（手動でコピー）"
            onFocus={(event) => event.currentTarget.select()}
          />
        )}
        <a href={shareUrl} className="btn btn--ghost btn--block" target="_blank" rel="noreferrer">
          公開ページを開く
        </a>
      </section>

      <section className="card card--padded stack">
        <div>
          <h2 className="panel__title">出欠の確認には会員登録が必要です</h2>
          <p className="help">
            {`公開したイベントはこの端末に紐づいています。会員登録すると同じイベントがあなたのアカウントに引き継がれ、参加者の回答・リマインド・領収書・共同幹事の招待が使えるようになります。無料枠は登録後もそのまま引き継がれます。`}
          </p>
        </div>
        <Link
          href={`/auth/register?mode=register&next=${encodeURIComponent(nextPath)}`}
          className="btn btn--primary btn--block"
        >
          会員登録して出欠を確認する
        </Link>
        <Link
          href={`/auth/register?mode=login&next=${encodeURIComponent(nextPath)}`}
          className="btn btn--outline btn--block"
        >
          すでに会員の方はログイン
        </Link>
      </section>

      <p className="help">
        いまは共有 URL の配布だけできます。主催一覧は
        <Link href={nextPath} className="text-link">
          こちら
        </Link>
        から開けます。編集は作成から24時間以内なら会員登録なしでもできます。
      </p>
    </div>
  );
}

export default function RegisterRequiredPage() {
  return (
    <Suspense
      fallback={
        <p className="loading">
          <span className="spinner" aria-hidden="true" />
          読み込んでいます
        </p>
      }
    >
      <RegisterRequiredScreen />
    </Suspense>
  );
}
