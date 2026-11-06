"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { isRegisterRequired, readProblem, readProblemBody } from "@/lib/problem";
import { Alert, Dialog, Loading } from "@/components/ui";

interface InviteCoHostModalProps {
  eventId: string;
  eventTitle: string;
  /** 招待リンクを発行できるか。主催者の会員だけが true。 */
  canInvite: boolean;
  /** 未登録の主催者か。案内を会員登録の導線に変える。 */
  registerRequired: boolean;
  onClose: () => void;
}

/**
 * 開いた時点の状態。`canInvite=false` のときは API を呼ばず、
 * 登録の導線か「主催者に頼んでください」の案内だけを出す。
 */
type InviteState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "ready"; url: string }
  | { kind: "register" }
  | { kind: "error"; message: string };

/**
 * 一覧の札から共同主催・幹事を招く 1 枚。
 *
 * 招待リンクは開いた時点で 1 回だけ発行する（7日で失効・1回で失効）。
 * コピーは `navigator.clipboard` を使い、http の公開や権限拒否で失敗したら
 * 入力欄を選択状態にして、手でコピーできる道へ切り替える。
 */
export function InviteCoHostModal({
  eventId,
  eventTitle,
  canInvite,
  registerRequired,
  onClose,
}: InviteCoHostModalProps) {
  const [state, setState] = useState<InviteState>(canInvite ? { kind: "loading" } : { kind: "idle" });
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  const copyTimer = useRef<number | null>(null);
  const manualInput = useRef<HTMLInputElement | null>(null);
  // 開き直しや開発時の再描画で、招待を二重に発行しない。
  const requested = useRef(false);

  useEffect(() => {
    if (!canInvite || requested.current) return;
    requested.current = true;

    const create = async () => {
      try {
        const res = await fetch(`/api/v1/organizer/events/${eventId}/invitations`, { method: "POST" });
        if (!res.ok) {
          // 本文は 2 回読めない。REGISTER_REQUIRED の判定用に写しを取り、文面は readProblem に任せる。
          const body = await readProblemBody(res.clone());
          if (isRegisterRequired(body)) {
            setState({ kind: "register" });
            return;
          }
          setState({ kind: "error", message: await readProblem(res) });
          return;
        }
        const created = (await res.json()) as { inviteUrl?: string };
        if (!created.inviteUrl) {
          setState({ kind: "error", message: "招待リンクを作成できませんでした" });
          return;
        }
        setState({ kind: "ready", url: `${window.location.origin}${created.inviteUrl}` });
      } catch {
        setState({ kind: "error", message: "招待リンクを作成できませんでした" });
      }
    };

    void create();
  }, [canInvite, eventId]);

  useEffect(() => {
    return () => {
      if (copyTimer.current !== null) window.clearTimeout(copyTimer.current);
    };
  }, []);

  const copyInviteUrl = async () => {
    if (state.kind !== "ready") return;
    try {
      await navigator.clipboard.writeText(state.url);
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

  const registerHref = `/organizer/register-required?eventId=${encodeURIComponent(eventId)}`;

  return (
    <Dialog
      title="共同主催・幹事を招待"
      titleId="invite-cohost-title"
      onClose={onClose}
      closeLabel="招待を閉じる"
      variant="center"
      actions={
        <>
          {state.kind === "ready" && (
            <button type="button" className="btn btn--primary btn--block" onClick={() => void copyInviteUrl()}>
              {copied ? "コピーしました" : "URLをコピー"}
            </button>
          )}
          <button type="button" className="btn btn--ghost btn--block" onClick={onClose}>
            閉じる
          </button>
        </>
      }
    >
      <div className="stack">
        {state.kind === "loading" && (
          <>
            <p className="dialog__body">「{eventTitle}」の共同主催・幹事を招待します。</p>
            <Loading>招待リンクを作っています</Loading>
          </>
        )}

        {state.kind === "ready" && (
          <>
            <p className="dialog__body">
              「{eventTitle}」のリンクを送ると、共同主催・幹事を1人増やせます。
            </p>
            <p className="help">相手は会員登録が必要です。リンクは7日間有効で、1回だけ使えます。</p>
            <div className="field">
              <label className="label visually-hidden" htmlFor="invite-cohost-url">
                招待リンク
              </label>
              <input
                id="invite-cohost-url"
                ref={manualInput}
                className="input"
                readOnly
                value={state.url}
                onFocus={(event) => event.currentTarget.select()}
              />
            </div>
            <p className="help" aria-live="polite">
              {copyFailed ? "コピーできませんでした。上の URL を選んでコピーしてください。" : ""}
            </p>
          </>
        )}

        {state.kind === "error" && (
          <>
            <Alert tone="error">{state.message}</Alert>
            <p className="help">時間をおいて、もう一度開いてください。</p>
          </>
        )}

        {state.kind === "register" && (
          <>
            <p className="dialog__body">招待リンクの発行には会員登録が必要です。</p>
            <p className="help">登録すると、このイベントはあなたのアカウントに引き継がれます。</p>
            <Link href={registerHref} className="btn btn--outline btn--block">
              登録して招待する
            </Link>
          </>
        )}

        {state.kind === "idle" &&
          (registerRequired ? (
            <>
              <p className="dialog__body">招待リンクの発行には会員登録が必要です。</p>
              <p className="help">登録すると、このイベントはあなたのアカウントに引き継がれます。</p>
              <Link href={registerHref} className="btn btn--outline btn--block">
                登録して招待する
              </Link>
            </>
          ) : (
            <p className="dialog__body">
              招待できるのは主催者だけです。共同主催・幹事の追加は主催者に頼んでください。
            </p>
          ))}
      </div>
    </Dialog>
  );
}
