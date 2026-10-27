"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { EventFormValues } from "@/modules/events/types";
import { buildFlyerFormPayload, validateFlyerForm } from "@/modules/flyers/lib/form";
import { readFlyerDraftKey, resetFlyerDraftKey } from "@/modules/flyers/lib/draft";
import { flyerDownloadHref } from "@/modules/flyers/lib/download";
import { flyerPdfDownloadHref } from "@/modules/flyers/lib/pdf-link";
import { flyerQuotaLabel } from "@/modules/flyers/lib/quota-label";
import type { FlyerQuota, SelectableFlyer } from "@/modules/flyers/types";
import { FlyerCandidateModal } from "./FlyerCandidateModal";
import { FlyerUploadButton } from "./FlyerUploadButton";
import { Alert } from "@/components/ui";

interface FlyerGeneratePanelProps {
  value: EventFormValues;
  disabled?: boolean;
  previewUrl: string | null;
  /** アップロード済み・生成済みのチラシ ID。ダウンロードの宛先に使う。 */
  flyerAssetId?: string | null;
  /** 下書きの単位。新規は "new"、編集はイベント ID。 */
  draftScope: string;
  /** 保存済みイベントの ID。共同主催者と同じ回数枠を数えるために送る。 */
  eventId?: string | null;
  /**
   * チラシを掲載しているイベントが公開済みか。
   * ダウンロードは告知 URL が確定してから出す（PDF の QR に焼き込むため）。
   */
  published?: boolean;
  onGenerated: (asset: { id: string; imageUrl: string }, status: string) => void;
  onClear: () => void;
}

export function FlyerGeneratePanel({
  value,
  disabled = false,
  previewUrl,
  flyerAssetId = null,
  draftScope,
  eventId = null,
  published = false,
  onGenerated,
  onClear,
}: FlyerGeneratePanelProps) {
  const [draftKey, setDraftKey] = useState<string | null>(null);
  const [quota, setQuota] = useState<FlyerQuota | null>(null);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusNote, setStatusNote] = useState<string | null>(null);

  useEffect(() => {
    setDraftKey(readFlyerDraftKey(draftScope));
  }, [draftScope]);

  useEffect(() => {
    if (!draftKey) return;
    let cancelled = false;
    void (async () => {
      try {
        const query = new URLSearchParams({ draftKey });
        if (eventId) query.set("eventId", eventId);
        const response = await fetch(`/api/v1/flyers/quota?${query.toString()}`);
        if (!response.ok) return;
        const data = (await response.json()) as { quota: FlyerQuota };
        if (!cancelled) setQuota(data.quota);
      } catch {
        // 残り回数は補助情報。取れなくても作成自体は試せる。
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [draftKey, eventId]);

  const base = useMemo(() => buildFlyerFormPayload(value), [value]);
  const exhausted = quota !== null && quota.remaining <= 0;

  const openWizard = useCallback(() => {
    const message = validateFlyerForm(value);
    if (message) {
      setError(message);
      return;
    }
    setError(null);
    setStatusNote(null);
    setOpen(true);
  }, [value]);

  const handleGenerated = useCallback(
    (asset: { id: string; imageUrl: string }, status: string) => {
      onGenerated(asset, status);
      setStatusNote(
        status === "fallback_used" ? "画像生成を代替背景で完了しました。" : null,
      );
    },
    [onGenerated],
  );

  /** アップロードは生成ではないので回数を消費せず、そのまま掲載する。 */
  const handleUploaded = useCallback(
    (flyer: SelectableFlyer) => {
      setError(null);
      setStatusNote(null);
      onGenerated({ id: flyer.id, imageUrl: flyer.imageUrl }, "uploaded");
    },
    [onGenerated],
  );

  const startOver = () => {
    const next = resetFlyerDraftKey(draftScope);
    setDraftKey(next);
    setQuota(null);
  };

  return (
    <div className="card stack">
      <div>
        <p className="label">チラシ生成</p>
        <p className="help">
          タイプ・背景・文字の配置・配色の 4 ステップで選んでから保存します。候補を作り直しても回数は減りません。チラシを作成・変更して保存したときだけ
          1 回消費します。手元の画像をアップロードする場合は回数を消費しません。
        </p>
      </div>

      {previewUrl && (
        <div className="poster">
          <img src={previewUrl} alt="生成したチラシ" />
        </div>
      )}

      {quota && (
        <p className="wizard__quota">
          {flyerQuotaLabel(quota, { eventScoped: Boolean(eventId) })}
        </p>
      )}

      <div className="btn-row">
        <button
          type="button"
          disabled={disabled || !draftKey || exhausted}
          onClick={openWizard}
          className="btn btn--sm"
        >
          {previewUrl ? "作り直す" : "チラシを作る"}
        </button>
        {previewUrl && flyerAssetId && published && (
          <>
            <a href={flyerDownloadHref(flyerAssetId)} className="btn btn--ghost btn--sm">
              画像でダウンロード
            </a>
            {eventId && (
              <a
                href={flyerPdfDownloadHref(flyerAssetId, eventId)}
                className="btn btn--ghost btn--sm"
              >
                PDFでダウンロード
              </a>
            )}
          </>
        )}
        {previewUrl && (
          <button
            type="button"
            disabled={disabled}
            onClick={() => {
              setStatusNote(null);
              onClear();
            }}
            className="btn btn--ghost btn--sm"
          >
            外す
          </button>
        )}
      </div>

      <div className="btn-row">
        <FlyerUploadButton
          title={value.title}
          disabled={disabled}
          onUploaded={handleUploaded}
          onError={setError}
        />
      </div>
      {previewUrl && flyerAssetId && !published && (
        <p className="help">
          公開すると、告知ページの QR コードを入れた A4 PDF をダウンロードできます。
        </p>
      )}
      <p className="help">
        Canva などで作った画像（JPEG / PNG / WebP、8MBまで）を、そのままチラシにできます。縦長の画像をおすすめします。
      </p>

      {exhausted && (
        <Alert tone="warning" as="div">
          {quota?.anonymous ? (
            <p>
              未ログインで作れるチラシは 1 回までです。
              <a href="/auth/register?mode=register">会員登録して続ける</a>
            </p>
          ) : eventId ? (
            <p>
              このイベントで作れるチラシは {quota?.limit} 回までです。共同主催者を含めた回数です。
            </p>
          ) : (
            <>
              <p>この下書きで作れるチラシは {quota?.limit} 回までです。</p>
              <button type="button" className="btn btn--ghost btn--sm" onClick={startOver}>
                新しい下書きで作り直す
              </button>
            </>
          )}
        </Alert>
      )}
      {statusNote && <Alert tone="warning">{statusNote}</Alert>}
      {error && <Alert tone="error">{error}</Alert>}

      {draftKey && (
        <FlyerCandidateModal
          open={open}
          draftKey={draftKey}
          eventId={eventId}
          base={base}
          onClose={() => setOpen(false)}
          onGenerated={handleGenerated}
          onQuotaChange={setQuota}
        />
      )}
    </div>
  );
}
