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

  // チラシが無いときは欄ごと出さない。題名・主催・日時は下の EventMetaCard が持つので、
  // 題名だけを大きく置いた黒い帯は、紙面の頭に空の余白を作るだけになる。
  if (!flyer) return null;

  return (
    <section className="poster-hero" aria-label="チラシ">
      {stamp && (
        <span className={`poster-hero__stamp${isFull ? " poster-hero__stamp--full" : ""}`}>{stamp}</span>
      )}
      {flyer.lqipDataUrl && !loaded && <img className="poster-hero__image" src={flyer.lqipDataUrl} alt="" aria-hidden="true" />}
      <img className="poster-hero__image" src={flyer.imageUrl} alt={`${title}のチラシ`} onLoad={() => setLoaded(true)} />
    </section>
  );
}
