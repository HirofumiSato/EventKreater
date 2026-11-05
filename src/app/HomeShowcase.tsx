"use client";

import { useCallback, useRef } from "react";
import type { CSSProperties, KeyboardEvent, PointerEvent, UIEvent } from "react";

/**
 * ホームのヒーロー右（スマホはコピーの下）に置く、実際に作った画面の見本。
 *
 * 外側は横 1 列の無限カルーセル、カードの中は同じ画像 2 枚を縦につないだ
 * 無限マーキーにする。傾きは付けない（`src/styles/deco/base.css` も参照）。
 *
 * 流れはどちらも CSS のアニメーションで動かす。JS のループで `scrollLeft` を
 * 書き換える形にすると、ハイドレーションが終わらない・フレームが来ない・
 * 状態の解除を取りこぼす、のどれか 1 つで止まったままになる。CSS なら
 * サーバーが返した HTML の時点で動き出し、止まるのは触っている間だけになる。
 * 横の手動スクロール（ドラッグ・スワイプ・矢印キー）だけを JS が受け持つ。
 *
 * 画像の原本は `storage/lp-shots/` にある（このディレクトリは追跡しない）。
 * 撮り直したときは `-full.webp` の 4 枚を同じ名前で `public/lp-shots/` へ
 * 上書きコピーする。`-hero` / `-rsvp-modal` は画面 1 枚分の切り抜きなので使わない。
 */
type Shot = {
  src: string;
  alt: string;
  width: number;
  height: number;
};

const SHOTS: readonly Shot[] = [
  {
    src: "/lp-shots/event-samurai-rock-full.webp",
    alt: "ライブイベントの告知ページ（見本）",
    width: 780,
    height: 3264,
  },
  {
    src: "/lp-shots/organizer-events-list.webp",
    alt: "主催者のイベント一覧（見本）",
    width: 780,
    height: 7358,
  },
  {
    src: "/lp-shots/organizer-participants-full.webp",
    alt: "主催者の参加者名簿（見本）",
    width: 780,
    height: 3104,
  },
  {
    src: "/lp-shots/organizer-sato-minori-full.webp",
    alt: "主催者の公開プロフィール（見本）",
    width: 780,
    height: 7178,
  },
];

/**
 * 横に並べるセットの数。帯を 1 セットぶん送って先頭へ戻すので、2 セットでも
 * 継ぎ目は消える。ただし帯の送りと手動スクロールは足し合わさるため、2 セット
 * だと「右端まで手で送った＋帯が終わり際」で右側が空く。3 セットあれば
 * どの組み合わせでも画面が埋まる。
 */
const SET_COUNT = 3;

/** カードの中を流す速さ（px / 秒）。カードごとの継続時間はここから逆算する。 */
const VERTICAL_PX_PER_SEC = 24;
/**
 * 継続時間を決めるときの基準のカード幅（px）。実際の幅は
 * `clamp(11.5rem, 25vw, 22rem)` で変わるが、カードどうしの見かけの速さを
 * そろえるのが目的なので、共通の基準で計算すればよい。
 */
const CARD_REFERENCE_WIDTH_PX = 320;

/** 画像の高さから、縦マーキー 1 往復の継続時間を秒で返す。 */
function markerDuration(shot: Shot): string {
  const renderedHeight = (shot.height / shot.width) * CARD_REFERENCE_WIDTH_PX;
  return `${(renderedHeight / VERTICAL_PX_PER_SEC).toFixed(1)}s`;
}

/** 1 セット分の幅。セットはすべて同じ並びなので、この幅で折り返せば継ぎ目が出ない。 */
function setWidth(scroller: HTMLElement): number {
  return scroller.scrollWidth / SET_COUNT;
}

/** 1 セット分の幅で折り返す（負の向きにも回す）。 */
function wrapScroll(value: number, unit: number): number {
  if (unit <= 0) return 0;
  const next = value % unit;
  return next < 0 ? next + unit : next;
}

export function HomeShowcase() {
  const dragRef = useRef<{ pointerId: number; startX: number; startScroll: number } | null>(null);

  const handlePointerDown = useCallback((event: PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    const scroller = event.currentTarget;
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startScroll: scroller.scrollLeft,
    };
    // つかみを取れない環境（合成したイベントなど）でも、そのまま追従は続ける。
    try {
      scroller.setPointerCapture(event.pointerId);
    } catch {
      // 取れなくても要素の上を動く間は pointermove が届く。
    }
  }, []);

  const handlePointerMove = useCallback((event: PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const scroller = event.currentTarget;
    const unit = setWidth(scroller);
    if (unit <= 0) return;
    scroller.scrollLeft = wrapScroll(drag.startScroll - (event.clientX - drag.startX), unit);
  }, []);

  /*
   * ドラッグの終わり。離した合図を取りこぼしても、止めるのは `:active` の
   * 間だけなので、次に触ったときに動かないままにはならない。
   */
  const endDrag = useCallback((event: PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }, []);

  /* トラックパッドの横スクロールで端まで行っても、空白が見えないよう折り返す。 */
  const handleScroll = useCallback((event: UIEvent<HTMLDivElement>) => {
    const scroller = event.currentTarget;
    const unit = setWidth(scroller);
    if (unit > 0 && scroller.scrollLeft >= unit) {
      scroller.scrollLeft = wrapScroll(scroller.scrollLeft, unit);
    }
  }, []);

  const handleKeyDown = useCallback((event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    const scroller = event.currentTarget;
    const unit = setWidth(scroller);
    if (unit <= 0) return;
    const item = scroller.querySelector<HTMLElement>(".hero__showcase-item");
    const step = item ? item.getBoundingClientRect().width : scroller.clientWidth * 0.8;
    const delta = event.key === "ArrowRight" ? step : -step;
    event.preventDefault();
    scroller.scrollLeft = wrapScroll(scroller.scrollLeft + delta, unit);
  }, []);

  return (
    <div className="hero__showcase">
      <div
        className="hero__showcase-scroller"
        role="region"
        aria-label="実際に作った画面の見本。横にスクロールできます。"
        tabIndex={0}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onLostPointerCapture={endDrag}
        onScroll={handleScroll}
        onKeyDown={handleKeyDown}
      >
        {/* 同じ並びを SET_COUNT セットつないで 1 本の帯にし、帯ごと左へ送る。
            送る量はちょうど 1 セット（CSS の translateX(-100% / 3)）。 */}
        <div className="hero__showcase-track">
          {Array.from({ length: SET_COUNT }, (_, copy) => (
            <div
              key={copy}
              className="hero__showcase-set"
              aria-hidden={copy === 0 ? undefined : true}
            >
              {SHOTS.map((shot) => (
                <div
                  key={shot.src}
                  className="hero__showcase-item"
                  style={{ "--showcase-duration": markerDuration(shot) } as CSSProperties}
                >
                  <div className="hero__showcase-frame">
                    {/* 同じ画像を 2 枚つなぎ、半分ずつ送って継ぎ目を消す。 */}
                    <div className="hero__showcase-reel">
                      <img
                        src={shot.src}
                        alt={copy === 0 ? shot.alt : ""}
                        width={shot.width}
                        height={shot.height}
                        draggable={false}
                      />
                      <img
                        src={shot.src}
                        alt=""
                        width={shot.width}
                        height={shot.height}
                        draggable={false}
                        aria-hidden="true"
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
