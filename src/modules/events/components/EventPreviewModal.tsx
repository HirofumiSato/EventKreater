"use client";

import { useMemo } from "react";
import type { EventFormValues } from "@/modules/events/types";
import { eventFormToPreview } from "@/modules/events/lib/preview";
import { PosterHero } from "@/modules/events/components/PosterHero";
import { EventMetaCard } from "@/modules/events/components/EventMetaCard";
import { Dialog, SemanticThemeScope } from "@/components/ui";

interface EventPreviewModalProps {
  value: EventFormValues;
  /** 作成中のチラシ。無ければ題字だけの面を出す。 */
  flyerPreviewUrl: string | null;
  onClose: () => void;
  /**
   * 下書き保存して本来のプレビュー（SCR-ORG-16）へ進む。
   * 会員だけが持つ導線なので、未登録の幹事には渡さない（ボタンを出さない）。
   */
  onContinue?: (() => void) | null;
  continuing?: boolean;
}

/**
 * 入力途中の内容を、告知ページと同じ部品・同じテーマで確かめるモーダル。
 *
 * ステップを閉じずに「この見た目で出る」を掴めるようにする。保存はしない。
 * プレビュー画面（SCR-ORG-16）へは、モーダルの中から 1 回だけ進める。
 */
export function EventPreviewModal({
  value,
  flyerPreviewUrl,
  onClose,
  onContinue = null,
  continuing = false,
}: EventPreviewModalProps) {
  const preview = useMemo(() => eventFormToPreview(value, flyerPreviewUrl), [value, flyerPreviewUrl]);

  return (
    <Dialog
      title="ここまでのプレビュー"
      titleId="event-preview-title"
      onClose={onClose}
      closeLabel="プレビューを閉じる"
      actions={
        <>
          {onContinue && (
            <button
              type="button"
              className="btn btn--primary btn--block"
              disabled={continuing}
              onClick={onContinue}
            >
              {continuing ? "保存中..." : "下書き保存してプレビューへ"}
            </button>
          )}
          <button type="button" className="btn btn--ghost btn--block" onClick={onClose}>
            編集を続ける
          </button>
        </>
      }
    >
      <div className="event-preview-modal">
        {/* テーマ未選択なら何も包まない。標準の見た目のまま確認できる。 */}
        <SemanticThemeScope themeId={value.themeId}>
          <div className="event-page">
            <PosterHero title={preview.title} flyer={preview.flyerAsset} stamp="プレビュー" />
            <EventMetaCard event={preview} />
          </div>
        </SemanticThemeScope>
      </div>
      <p className="help event-preview-modal__note">
        入力を終えていない欄は「未入力」と出ます。公開すると、この内容がそのまま告知ページになります。
      </p>
    </Dialog>
  );
}
