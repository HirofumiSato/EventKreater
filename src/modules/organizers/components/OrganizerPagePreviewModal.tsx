"use client";

import { useCallback, useEffect, useState } from "react";
import { OrganizerPageView } from "./OrganizerPageView";
import { OrganizerProfileView } from "./OrganizerProfileView";
import type { OrganizerProfileContent, PublicOrganizerProfileResponse } from "@/modules/organizers/types";
import { Loading } from "@/components/ui";

interface OrganizerPagePreviewModalProps {
  userId: string;
  organizerName: string;
  onClose: () => void;
}

/**
 * 主催者が、参加者から見た自分の公開ページを確認するモーダル。
 *
 * 統合ページと同じく、プロフィールの下に催しを並べる。
 * 中身はログイン済みの見え方だけを出す（未ログインのぼかし表示は出さない）。
 * 月の移動はURLへ書かず、モーダルの中で完結させる。
 */
export function OrganizerPagePreviewModal({ userId, organizerName, onClose }: OrganizerPagePreviewModalProps) {
  const [profile, setProfile] = useState<OrganizerProfileContent | null>(null);
  const [name, setName] = useState(organizerName);

  const load = useCallback(async () => {
    const res = await fetch(`/api/v1/public/organizers/${userId}`, { cache: "no-store" });
    if (!res.ok) return;
    const data = (await res.json()) as PublicOrganizerProfileResponse;
    setName(data.name);
    setProfile(data.profile);
  }, [userId]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="modal" style={{ display: "flex" }}>
      <button type="button" className="modal__backdrop" aria-label="閉じる" onClick={onClose} />
      <div className="dialog dialog--preview" role="dialog" aria-modal="true" aria-labelledby="organizer-preview-title">
        <div className="organizer-preview__head">
          <div>
            <p className="eyebrow">プレビュー</p>
            <h3 id="organizer-preview-title" className="dialog__title">
              参加者から見た {organizerName} さんのページ
            </h3>
            <p className="help">ログイン済みの参加者に表示される内容です。</p>
          </div>
          <button type="button" className="btn btn--sm" onClick={onClose}>
            閉じる
          </button>
        </div>
        <div className="stack">
          {profile ? (
            <OrganizerProfileView name={name} profile={profile} />
          ) : (
            <Loading>
              読み込んでいます
            </Loading>
          )}
          <OrganizerPageView userId={userId} preview />
        </div>
      </div>
    </div>
  );
}
