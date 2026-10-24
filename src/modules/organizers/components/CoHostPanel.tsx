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
    <section className="panel">
      <div className="panel__head">
        <h2 className="panel__title">共同幹事</h2>
        <p className="panel__note">
          招待リンクから、もう 1人を幹事に加えられます。解除はその場で確認します。
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
          <ul className="rows">
            {owner && (
              <li className="rows__item">
                <div className="rows__main">
                  <p className="rows__title">{owner.name}</p>
                  <p className="rows__meta">
                    筆頭幹事 ／ 公開・非公開を変えられる
                    {owner.isGuest ? " ／ 未登録の幹事" : ""}
                  </p>
                </div>
                <span className="badge badge--neutral badge--sm">主催</span>
              </li>
            )}
            {coHosts.map((row) => (
              <li key={row.id} className="rows__item">
                <div className="rows__main">
                  <p className="rows__title">{row.name}</p>
                  <p className="rows__meta">
                    共同幹事 ／ 名簿と売上を見られる
                    {row.isGuest ? " ／ 未登録の幹事" : ""}
                  </p>
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
            {coHosts.length === 0 && (
              <li className="rows__item">
                <div className="rows__main">
                  <p className="rows__title">共同幹事はまだいません</p>
                  <p className="rows__meta">招待リンクを発行すると、もう 1人を加えられます。</p>
                </div>
              </li>
            )}
          </ul>

          {data?.canManage ? (
            <div className="panel__actions">
              <button
                type="button"
                disabled={pending}
                onClick={() => void createInvite()}
                className="btn btn--outline btn--sm"
              >
                {pending ? "作成しています..." : "招待リンクを発行"}
              </button>
            </div>
          ) : data?.registerRequired ? (
            <div className="stack">
              <p className="help">
                共同主催者の招待・削除には会員登録が必要です。登録すると、いまのイベントはあなたのアカウントに引き継がれます。
              </p>
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

          {shareUrl && (
            <div className="panel">
              <p className="panel__title">招待リンク</p>
              <p className="quote">{shareUrl}</p>
              {expiresAt && <p className="help">有効期限 {new Date(expiresAt).toLocaleString("ja-JP")}</p>}
              <p className="help">
                URLを知っている会員が受諾すると、共同主催者に加わります。7日間有効で、一度受諾すると無効になります。
              </p>
              <div className="panel__actions">
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
            </div>
          )}
        </>
      )}
    </section>
  );
}
