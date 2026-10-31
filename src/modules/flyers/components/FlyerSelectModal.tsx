"use client";

import { useEffect, useState } from "react";
import { readProblem } from "@/lib/problem";
import { flyerDownloadHref } from "@/modules/flyers/lib/download";
import type { SelectableFlyer } from "@/modules/flyers/types";
import { FlyerUploadButton } from "./FlyerUploadButton";
import { Alert, Dialog, EmptyState, Loading } from "@/components/ui";

export type { SelectableFlyer } from "@/modules/flyers/types";

interface FlyerSelectModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (flyer: SelectableFlyer) => void;
  /** アップロードしたチラシの表示名に使うイベント名。 */
  title?: string;
}

export function FlyerSelectModal({
  isOpen,
  onClose,
  onSelect,
  title = "",
}: FlyerSelectModalProps) {
  const [flyers, setFlyers] = useState<SelectableFlyer[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    let active = true;
    setLoading(true);
    setError(null);
    void fetch("/api/v1/flyer-assets")
      .then(async (res) => {
        if (!res.ok) throw new Error(await readProblem(res));
        return (await res.json()) as { flyers: SelectableFlyer[] };
      })
      .then((data) => {
        if (active) {
          setFlyers(data.flyers);
          setError(null);
        }
      })
      .catch((cause: unknown) => {
        if (active) setError(cause instanceof Error ? cause.message : "チラシを読み込めませんでした");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [isOpen]);

  const remove = async (id: string) => {
    const res = await fetch(`/api/v1/flyer-assets/${id}`, { method: "DELETE" });
    if (!res.ok) {
      setError(await readProblem(res));
      return;
    }
    setFlyers((current) => current.filter((flyer) => flyer.id !== id));
  };

  if (!isOpen) return null;

  return (
    <Dialog title="チラシ選択" titleId="flyer-select-title" onClose={onClose}>
      <p className="dialog__body">選ぶと、生成時の7項目が作成フォームに入ります。アップロードした画像は、そのままチラシとして使えます。削除すると一覧から外れます。掲載中のイベントの画像はそのまま残ります。</p>
        <div className="btn-row">
          <FlyerUploadButton
            title={title}
            disabled={loading}
            onUploaded={(flyer) => {
              onSelect(flyer);
              onClose();
            }}
            onError={setError}
          />
        </div>
        <p className="help">Canva などで作った画像（JPEG / PNG / WebP、8MBまで）を、そのままチラシにできます。</p>
        {loading && <p className="loading">読み込んでいます</p>}
        {error && <p className="alert alert--error">{error}</p>}
        {!loading && flyers.length === 0 && <p className="empty">この端末で作った・アップロードしたチラシはまだありません。</p>}
        <div className="card-grid">
          {flyers.map((flyer) => (
            <article key={flyer.id} className="card">
              <img src={flyer.imageUrl} alt="" style={{ width: "100%", height: "8rem", objectFit: "cover" }} />
              <p className="card__title">{flyer.title || "無題のチラシ"}</p>
              <div className="btn-row">
                <button
                  type="button"
                  className="btn btn--primary btn--sm"
                  onClick={() => {
                    onSelect(flyer);
                    onClose();
                  }}
                >
                  このチラシを使う
                </button>
                <a href={flyerDownloadHref(flyer.id)} className="btn btn--ghost btn--sm">
                  ダウンロード
                </a>
                <button type="button" className="btn btn--danger btn--sm" onClick={() => void remove(flyer.id)}>
                  削除
                </button>
              </div>
            </article>
          ))}
        </div>
        <button type="button" onClick={onClose} className="btn btn--ghost btn--block">
          閉じる
        </button>
    </Dialog>
  );
}
