"use client";

import { useState } from "react";
import { isRegisterRequired, readProblemBody, sendToRegisterRequired } from "@/lib/problem";

export function InviteOrganizerButton({ eventId }: { eventId: string }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const createInvite = async () => {
    setPending(true);
    setError(null);
    setCopied(false);
    try {
      const res = await fetch(`/api/v1/organizer/events/${eventId}/invitations`, { method: "POST" });
      if (!res.ok) {
        const body = await readProblemBody(res);
        if (isRegisterRequired(body)) {
          sendToRegisterRequired(eventId);
          throw new Error("共同幹事の招待には会員登録が必要です。案内ページへ移動しています。");
        }
        throw new Error(body.detail || "招待URLを作成できませんでした");
      }
      const data = (await res.json()) as { inviteUrl: string; expiresAt: string };
      setShareUrl(`${window.location.origin}${data.inviteUrl}`);
      setExpiresAt(data.expiresAt);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "招待URLを作成できませんでした");
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="card stack">
      <div>
        <p className="label">共同幹事</p>
        <p className="help">招待URLを知っている人が、このイベントの共同幹事になれます。URLは7日間有効で、一度受諾すると無効になります。</p>
      </div>
      <button type="button" disabled={pending} onClick={() => void createInvite()} className="btn btn--sm">
        {pending ? "作成しています..." : "招待URLを作る"}
      </button>
      {error && <p className="alert alert--error">{error}</p>}
      {shareUrl && (
        <div className="stack">
          <p className="quote">{shareUrl}</p>
          {expiresAt && <p className="help">有効期限 {new Date(expiresAt).toLocaleString("ja-JP")}</p>}
          <button
            type="button"
            onClick={() => {
              void navigator.clipboard.writeText(shareUrl).then(() => setCopied(true));
            }}
            className="btn btn--primary btn--sm"
          >
            {copied ? "コピーしました" : "URLをコピー"}
          </button>
        </div>
      )}
    </div>
  );
}
