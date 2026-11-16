import type { FlyerAsset } from "@/modules/events/types";

interface PosterHeroProps {
  title: string;
  flyer: FlyerAsset | null;
  /** チラシの左上に貼る札。受付中・満員・受付終了のどれか。 */
  stamp?: string;
  isFull?: boolean;
}

/**
 * チラシの縦横比。紙面は A4 縦と 9:16 の 2 通りだけ。
 * 未知の値では高さを指定せず、画像の原寸に任せる（間違った比で切るより余白が出る方がよい）。
 */
const POSTER_ASPECT_RATIOS: Record<string, string> = {
  A4: "210 / 297",
  "9:16": "9 / 16",
};

/**
 * 告知ページのチラシ。
 *
 * チラシは最初の 1 枚（LCP）なので、HTML に載せて先に取りに行かせる
 * （`fetchPriority="high"`）。高さは `flyer.aspectRatio` から先に確保し、
 * 画像が届くまで下の本文が動かないようにする。
 *
 * 以前は低解像度の下地（`lqipDataUrl`）を重ねていたが、書き込む側が無く
 * 常に null だった。`onLoad` で再描画する分だけ初回が遅れるので落とした。
 */
export function PosterHero({ title, flyer, stamp, isFull = false }: PosterHeroProps) {
  // チラシが無いときは欄ごと出さない。題名・主催・日時は下の EventMetaCard が持つので、
  // 題名だけを大きく置いた黒い帯は、紙面の頭に空の余白を作るだけになる。
  if (!flyer) return null;

  const aspectRatio = POSTER_ASPECT_RATIOS[flyer.aspectRatio];

  return (
    <section className="poster-hero" aria-label="チラシ">
      {stamp && (
        <span className={`poster-hero__stamp${isFull ? " poster-hero__stamp--full" : ""}`}>{stamp}</span>
      )}
      <img
        className="poster-hero__image"
        src={flyer.imageUrl}
        alt={`${title}のチラシ`}
        style={aspectRatio ? { aspectRatio } : undefined}
        fetchPriority="high"
        decoding="async"
      />
    </section>
  );
}
