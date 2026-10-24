"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { loginUrl, registerUrl } from "@/lib/auth-links";
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
 * イベントは公開されたまま残る。出欠の確認・リマインド・領収書・共同主催者の招待は
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
      router.replace("/organizer/events");
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
        <div>
          <p className="eyebrow">公開</p>
          <h1 className="page-title">公開しました</h1>
          <p className="page-lead">
            このページは公開直後の幹事向けです。続けて出欠を確認するには、会員登録をしてください。
          </p>
        </div>
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
          <p className="eyebrow">公開</p>
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

  // 登録・ログインのあとは主催一覧へ。編集画面へ直接送らない（イベントはカードから開く）。
  const nextPath = "/organizer/events?registered=1";
  const listPath = "/organizer/events";

  return (
    <div className="page--form stack">
      <div>
        <p className="eyebrow">公開</p>
        <h1 className="page-title">公開しました</h1>
        <p className="page-lead">
          この URL を参加者に送ってください。登録なしで出欠を答えられます。
        </p>
      </div>

      <p className="alert alert--success">
        {state.title ? `「${state.title}」を公開しました。` : "イベントを公開しました。"}
      </p>

      <section className="panel">
        <p className="panel__title">参加者に送る URL</p>
        <div className="field">
          <label className="label visually-hidden" htmlFor="share-url">
            参加者に送る URL
          </label>
          <input
            id="share-url"
            ref={manualInput}
            className="input"
            readOnly
            value={shareUrl}
            onFocus={(event) => event.currentTarget.select()}
          />
        </div>
        <div className="panel__actions">
          <button type="button" className="btn btn--primary btn--sm" onClick={() => void copyShareUrl()}>
            {copied ? "コピーしました" : "コピー"}
          </button>
          <a href={shareUrl} className="btn btn--outline btn--sm" target="_blank" rel="noreferrer">
            ページを見る
          </a>
        </div>
        <p className="help" aria-live="polite">
          {copyFailed ? "コピーできませんでした。上の URL を選んでコピーしてください。" : ""}
        </p>
      </section>

      <section className="section">
        <div className="section__head">
          <h2 className="section__title">登録すると、できること</h2>
          <p className="section__note">いまは公開だけです。名簿から先は、会員登録のあとで使えます。</p>
        </div>
        <ul className="rows">
          <li className="rows__item">
            <div className="rows__main">
              <p className="rows__title">参加者名簿</p>
              <p className="rows__meta">出欠、人数、費用、支払いを 1枚で見られます。</p>
            </div>
            <span className="badge badge--neutral badge--sm">登録後</span>
          </li>
          <li className="rows__item">
            <div className="rows__main">
              <p className="rows__title">リマインド</p>
              <p className="rows__meta">開催が近づいたら、参加者へ案内を送れます。</p>
            </div>
            <span className="badge badge--neutral badge--sm">登録後</span>
          </li>
          <li className="rows__item">
            <div className="rows__main">
              <p className="rows__title">領収書</p>
              <p className="rows__meta">参加費を受け取ったら、その場で発行できます。</p>
            </div>
            <span className="badge badge--neutral badge--sm">登録後</span>
          </li>
          <li className="rows__item">
            <div className="rows__main">
              <p className="rows__title">共同幹事の招待</p>
              <p className="rows__meta">もう 1人を、同じ催しの幹事に加えられます。</p>
            </div>
            <span className="badge badge--neutral badge--sm">登録後</span>
          </li>
        </ul>

        <div className="panel__actions">
          <Link href={registerUrl(nextPath)} className="btn btn--primary btn--block">
            会員登録して出欠を確認する
          </Link>
        </div>
        <div className="panel__actions">
          <Link href={loginUrl(nextPath)} className="btn btn--outline btn--block">
            すでに会員の方はログイン
          </Link>
        </div>

        <p className="screen-note">
          作った内容は、登録後そのまま引き継がれます。登録しなくても、公開した催しはこのまま動きます。
        </p>
      </section>

      <p className="screen-note">
        この画面は検索に出しません。第三者がこの URL を開いても、案内は出ません。主催一覧は
        <Link href={listPath} className="text-link">
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
