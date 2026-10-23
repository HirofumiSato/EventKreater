"use client";

import { useEffect, useState } from "react";
import { formatPostalCode } from "@/lib/postal-code";
import { readProblem } from "@/lib/problem";

/** 過去に入力した会場。GET /api/v1/venues の 1 件ぶん。 */
export interface SelectableVenue {
  id: string;
  venueName: string | null;
  postalCode: string | null;
  prefecture: string | null;
  city: string | null;
  town: string | null;
  addressLine: string | null;
  building: string | null;
  /** 会場名と住所を合成した表示用の文字列。 */
  location: string;
  lastUsedAt: string;
}

interface VenueSelectModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (venue: SelectableVenue) => void;
}

/** 会場名の下に出す住所。会場名は見出しに出すので、ここでは省く。 */
function addressText(venue: SelectableVenue): string {
  const address = [venue.prefecture, venue.city, venue.town, venue.addressLine]
    .map((part) => part?.trim() ?? "")
    .join("");
  return [address, venue.building?.trim() ?? ""].filter(Boolean).join(" ");
}

function usedAtText(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return `${date.toLocaleDateString("ja-JP")} に使用`;
}

/**
 * 過去に入力した会場から選ぶ。選ぶと会場名・郵便番号・住所がまとめて入る。
 * 候補はこの端末とアカウントの過去イベントから作る（他人の会場は出ない）。
 */
export function VenueSelectModal({ isOpen, onClose, onSelect }: VenueSelectModalProps) {
  const [venues, setVenues] = useState<SelectableVenue[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    let active = true;
    setLoading(true);
    setError(null);
    void fetch("/api/v1/venues", { cache: "no-store" })
      .then(async (res) => {
        if (!res.ok) throw new Error(await readProblem(res));
        return (await res.json()) as { venues: SelectableVenue[] };
      })
      .then((data) => {
        if (active) setVenues(data.venues);
      })
      .catch((cause: unknown) => {
        if (active) setError(cause instanceof Error ? cause.message : "会場を読み込めませんでした");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [isOpen]);

  const remove = async (id: string) => {
    const res = await fetch(`/api/v1/venues/${id}`, { method: "DELETE" });
    if (!res.ok) {
      setError(await readProblem(res));
      return;
    }
    setVenues((current) => current.filter((venue) => venue.id !== id));
  };

  if (!isOpen) return null;

  return (
    <div className="modal" style={{ display: "flex" }}>
      <button type="button" className="modal__backdrop" aria-label="閉じる" onClick={onClose} />
      <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="venue-select-title">
        <h3 id="venue-select-title" className="dialog__title">
          過去の会場から選ぶ
        </h3>
        <p className="dialog__body">
          選ぶと、会場名・郵便番号・住所がまとめて入ります。この端末とアカウントで過去に使った会場だけが出ます。
        </p>
        {loading && <p className="loading">読み込んでいます</p>}
        {error && <p className="alert alert--error">{error}</p>}
        {!loading && venues.length === 0 && (
          <p className="empty">
            過去に使った会場はまだありません。イベントを下書き保存するか公開すると、次回からここに出ます。
          </p>
        )}
        <div className="choice-group choice-group--stack">
          {venues.map((venue) => {
            const address = addressText(venue);
            return (
              <div key={venue.id} className="repeat-row repeat-row--venue">
                <button
                  type="button"
                  className="choice choice--left"
                  onClick={() => {
                    onSelect(venue);
                    onClose();
                  }}
                >
                  <span className="choice__body">
                    <span className="choice__title">{venue.venueName || address || venue.location}</span>
                    {address && <span className="help">{address}</span>}
                    <span className="help">
                      {[
                        venue.postalCode ? `〒${formatPostalCode(venue.postalCode)}` : "",
                        usedAtText(venue.lastUsedAt),
                      ]
                        .filter(Boolean)
                        .join(" / ")}
                    </span>
                  </span>
                </button>
                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  aria-label="この会場を候補から削除"
                  onClick={() => void remove(venue.id)}
                >
                  削除
                </button>
              </div>
            );
          })}
        </div>
        <button type="button" onClick={onClose} className="btn btn--ghost btn--block">
          閉じる
        </button>
      </div>
    </div>
  );
}
