"use client";

import { OrganizerPageView } from "./OrganizerPageView";

interface OrganizerPagePreviewModalProps {
  userId: string;
  organizerName: string;
  onClose: () => void;
}

/**
 * 主催者が、参加者から見た自分の公開ページを確認するモーダル。
 *
 * 中身はログイン済みの見え方だけを出す（未ログインのぼかし表示は出さない）。
 * タブの切り替えや月の移動はURLへ書かず、モーダルの中で完結させる。
 */
export function OrganizerPagePreviewModal({ userId, organizerName, onClose }: OrganizerPagePreviewModalProps) {
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
        <OrganizerPageView userId={userId} preview />
      </div>
    </div>
  );
}
