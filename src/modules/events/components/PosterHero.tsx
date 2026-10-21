"use client";

import { useState } from "react";
import type { FlyerAsset } from "@/modules/events/types";

interface PosterHeroProps {
  title: string;
  flyer: FlyerAsset | null;
}

export function PosterHero({ title, flyer }: PosterHeroProps) {
  const [loaded, setLoaded] = useState(false);

  return (
    <section className="poster" aria-label="チラシ">
      {flyer?.lqipDataUrl && !loaded && <img src={flyer.lqipDataUrl} alt="" aria-hidden="true" />}
      {flyer ? (
        <img src={flyer.imageUrl} alt={`${title}のチラシ`} onLoad={() => setLoaded(true)} />
      ) : (
        <div className="poster__fallback">
          <h1 className="panel__title" style={{ color: "#fff" }}>
            {title}
          </h1>
        </div>
      )}
    </section>
  );
}
