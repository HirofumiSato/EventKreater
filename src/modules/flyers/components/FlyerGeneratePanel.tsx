"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { EventFormValues } from "@/modules/events/types";
import { buildFlyerFormPayload, validateFlyerForm } from "@/modules/flyers/lib/form";
import { readFlyerDraftKey, resetFlyerDraftKey } from "@/modules/flyers/lib/draft";
import type { FlyerQuota } from "@/modules/flyers/types";
import { FlyerCandidateModal } from "./FlyerCandidateModal";

interface FlyerGeneratePanelProps {
  value: EventFormValues;
  disabled?: boolean;
  previewUrl: string | null;
  /** 下書きの単位。新規は "new"、編集はイベント ID。 */
  draftScope: string;
  onGenerated: (asset: { id: string; imageUrl: string }, status: string) => void;
  onClear: () => void;
}

export function FlyerGeneratePanel({
  value,
  disabled = false,
  previewUrl,
  draftScope,
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
        const response = await fetch(
          `/api/v1/flyers/quota?draftKey=${encodeURIComponent(draftKey)}`,
        );
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
  }, [draftKey]);

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
          タイプ・背景・文字の配置・配色の 4 ステップで選んでから保存します。候補を作り直しても回数は減りません。保存したときだけ 1
          回消費します。
        </p>
      </div>

      {previewUrl && (
        <div className="poster">
          <img src={previewUrl} alt="生成したチラシ" />
        </div>
      )}

      {quota && (
        <p className="wizard__quota">
          {quota.anonymous
            ? `未ログインで作れるのは残り ${quota.remaining} 回`
            : `この下書きは残り ${quota.remaining} 回 / ${quota.limit} 回`}
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

      {exhausted && (
        <div className="alert alert--warning">
          {quota?.anonymous ? (
            <p>
              未ログインで作れるチラシは 1 回までです。
              <a href="/auth/register?mode=register">会員登録して続ける</a>
            </p>
          ) : (
            <>
              <p>この下書きで作れるチラシは {quota?.limit} 回までです。</p>
              <button type="button" className="btn btn--ghost btn--sm" onClick={startOver}>
                新しい下書きで作り直す
              </button>
            </>
          )}
        </div>
      )}
      {statusNote && <p className="alert alert--warning">{statusNote}</p>}
      {error && <p className="alert alert--error">{error}</p>}

      {draftKey && (
        <FlyerCandidateModal
          open={open}
          draftKey={draftKey}
          base={base}
          onClose={() => setOpen(false)}
          onGenerated={handleGenerated}
          onQuotaChange={setQuota}
        />
      )}
    </div>
  );
}
