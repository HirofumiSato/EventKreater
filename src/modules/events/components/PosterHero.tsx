"use client";

import { useState } from "react";
import type { FlyerAsset } from "@/modules/events/types";

interface PosterHeroProps {
  title: string;
  flyer: FlyerAsset | null;
  /** チラシの左上に貼る札。受付中・満員・受付終了のどれか。 */
  stamp?: string;
  isFull?: boolean;
}

export function PosterHero({ title, flyer, stamp, isFull = false }: PosterHeroProps) {
  const [loaded, setLoaded] = useState(false);

  return (
    <section className="poster-hero" aria-label="チラシ">
      {stamp && (
        <span className={`poster-hero__stamp${isFull ? " poster-hero__stamp--full" : ""}`}>{stamp}</span>
      )}
      {flyer?.lqipDataUrl && !loaded && <img className="poster-hero__image" src={flyer.lqipDataUrl} alt="" aria-hidden="true" />}
      {flyer ? (
        <img className="poster-hero__image" src={flyer.imageUrl} alt={`${title}のチラシ`} onLoad={() => setLoaded(true)} />
      ) : (
        <div className="poster-hero__fallback">
          <p className="poster-hero__fallback-title">{title}</p>
        </div>
      )}
    </section>
  );
}
