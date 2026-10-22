"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { isRegisterRequired, readProblem, readProblemBody } from "@/lib/problem";
import type { EventOrganizerList } from "@/modules/events/types";

interface OrganizerResponse {
  organizers: EventOrganizerList;
  role: "OWNER" | "CO_HOST";
  canManage: boolean;
  registerRequired: boolean;
}

/**
 * イベント編集画面の幹事パネル。
 * 筆頭幹事（オーナー）と共同主催者を分けて見せ、オーナーだけが招待・削除できる。
 */
export function CoHostPanel({ eventId }: { eventId: string }) {
  const [data, setData] = useState<OrganizerResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/v1/organizer/events/${eventId}/organizers`, { cache: "no-store" });
      if (!res.ok) throw new Error(await readProblem(res));
      setData((await res.json()) as OrganizerResponse);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "幹事を読み込めませんでした");
    } finally {
      setLoading(false);
    }
  }, [eventId]);

  useEffect(() => {
    void load();
  }, [load]);

  const createInvite = async () => {
    setPending(true);
    setError(null);
    setCopied(false);
    try {
      const res = await fetch(`/api/v1/organizer/events/${eventId}/invitations`, { method: "POST" });
      if (!res.ok) {
        const body = await readProblemBody(res);
        if (isRegisterRequired(body)) {
          throw new Error("共同主催者の招待には会員登録が必要です。案内ページから登録してください。");
        }
        throw new Error(body.detail || "招待URLを作成できませんでした");
      }
      const created = (await res.json()) as { inviteUrl: string; expiresAt: string };
      setShareUrl(`${window.location.origin}${created.inviteUrl}`);
      setExpiresAt(created.expiresAt);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "招待URLを作成できませんでした");
    } finally {
      setPending(false);
    }
  };

  const removeCoHost = async (organizerId: string) => {
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/organizer/events/${eventId}/organizers/${organizerId}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error(await readProblem(res));
      setRemovingId(null);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "共同主催者を外せませんでした");
    } finally {
      setPending(false);
    }
  };

  const owner = data?.organizers.owner ?? null;
  const coHosts = data?.organizers.coHosts ?? [];

  return (
    <section className="card stack">
      <div>
        <p className="label">幹事</p>
        <p className="help">
          公開ページには「主催」と「共同主催」を分けて表示します。共同主催者は、イベントの編集・名簿・領収書を筆頭幹事と分担できます。招待された側は会員登録が必要です。
        </p>
      </div>
      {error && <p className="alert alert--error">{error}</p>}
      {loading ? (
        <p className="loading">
          <span className="spinner" aria-hidden="true" />
          幹事を読み込んでいます
        </p>
      ) : (
        <>
          <div className="stack">
            {owner && (
              <div className="summary">
                <div>
                  <p className="eyebrow eyebrow--muted">主催（筆頭幹事）</p>
                  <p className="summary__name">{owner.name}</p>
                  {owner.isGuest && <p className="help">未登録の幹事</p>}
                </div>
              </div>
            )}
            <div>
              <p className="eyebrow eyebrow--muted">共同主催</p>
              {coHosts.length === 0 ? (
                <p className="help">まだいません。</p>
              ) : (
                <ul className="stack" style={{ marginTop: "0.5rem" }}>
                  {coHosts.map((row) => (
                    <li key={row.id} className="summary">
                      <div>
                        <p>{row.name}</p>
                        {row.isGuest && <p className="help">未登録の幹事</p>}
                      </div>
                      {data?.canManage &&
                        (removingId === row.id ? (
                          <div className="btn-row">
                            <button
                              type="button"
                              className="btn btn--danger btn--sm"
                              disabled={pending}
                              onClick={() => void removeCoHost(row.id)}
                            >
                              本当に外す
                            </button>
                            <button
                              type="button"
                              className="btn btn--ghost btn--sm"
                              disabled={pending}
                              onClick={() => setRemovingId(null)}
                            >
                              やめる
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            className="btn btn--ghost btn--sm"
                            disabled={pending}
                            onClick={() => setRemovingId(row.id)}
                          >
                            外す
                          </button>
                        ))}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          {data?.canManage ? (
            <div className="stack">
              <button type="button" disabled={pending} onClick={() => void createInvite()} className="btn btn--sm">
                {pending ? "作成しています..." : "招待URLを作る"}
              </button>
              {shareUrl && (
                <div className="stack">
                  <p className="quote">{shareUrl}</p>
                  {expiresAt && <p className="help">有効期限 {new Date(expiresAt).toLocaleString("ja-JP")}</p>}
                  <p className="help">URLを知っている会員が受諾すると、共同主催者に加わります。7日間有効で、一度受諾すると無効になります。</p>
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
          ) : data?.registerRequired ? (
            <div className="stack">
              <p className="help">共同主催者の招待・削除には会員登録が必要です。登録すると、いまのイベントはあなたのアカウントに引き継がれます。</p>
              <Link
                href={`/organizer/register-required?eventId=${encodeURIComponent(eventId)}`}
                className="btn btn--outline btn--sm"
              >
                会員登録して幹事を管理する
              </Link>
            </div>
          ) : (
            <p className="help">共同主催者の招待・削除は筆頭幹事だけが行えます。</p>
          )}
        </>
      )}
    </section>
  );
}
