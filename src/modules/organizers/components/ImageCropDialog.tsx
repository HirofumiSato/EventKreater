"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Dialog } from "@/components/ui";
import {
  MAX_ZOOM,
  MIN_HEADER_CROP_WIDTH,
  MIN_ZOOM,
  clampOffset,
  coverScale,
  cropSourceRect,
  isCropLargeEnough,
  maxZoomForMinCrop,
  zoomAroundCenter,
} from "@/modules/organizers/lib/crop";

/** 送る画像の幅の上限。サーバーは 1920px に作り直すので、それを余裕で超える大きさだけ残す。 */
const MAX_OUTPUT_WIDTH = 3200;

/** 送る画像の質。3:1 の写真なら 0.9 で十分にきれいで、8MB にも収まる。 */
const OUTPUT_QUALITY = 0.9;

/** 矢印キー 1 回で動かす幅（枠の CSS ピクセル）。 */
const NUDGE = 10;

/** 表示用 canvas の画素の上限倍率。端末の負担を抑えつつ、拡大しても粗く見せない。 */
const MAX_DEVICE_PIXEL_RATIO = 2;

interface ImageCropDialogProps {
  /** 切り抜く元の画像。閉じるときは親が外す。 */
  file: File;
  /** 送信中。確定と閉じるを止める。 */
  busy: boolean;
  /** 送信に失敗した理由。 */
  error: string | null;
  /** 切り抜かずに閉じる。 */
  onCancel: () => void;
  /** 3:1 に切り抜いた JPEG。 */
  onConfirm: (blob: Blob) => void;
}

type Status = "loading" | "ready" | "error";

/**
 * ヘッダー画像の切り抜き（SCR-ORG-14）。
 *
 * 3:1 の枠の中で画像をドラッグ（または矢印キー）で動かし、スライダーで 1〜3 倍に拡大する。
 * 計算は `lib/crop.ts` に任せ、ここでは枠の実寸を渡して描くだけにする。
 *
 * 表示には `<canvas>` を使う。`createImageBitmap` の `from-image` で端末の向きを反映した
 * 1 枚を、位置と倍率から描き直す。向きの違う写真でも、見えている範囲がそのまま保存される。
 */
export function ImageCropDialog({ file, busy, error, onCancel, onConfirm }: ImageCropDialogProps) {
  const [status, setStatus] = useState<Status>("loading");
  const [natural, setNatural] = useState({ width: 0, height: 0 });
  const [frame, setFrame] = useState({ width: 0, height: 0 });
  const [zoom, setZoom] = useState(MIN_ZOOM);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [processing, setProcessing] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  const frameRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const bitmapRef = useRef<ImageBitmap | null>(null);
  /** ドラッグ中の指の位置。離した時点で null に戻す。 */
  const dragRef = useRef<{ pointerId: number; x: number; y: number; offsetX: number; offsetY: number } | null>(
    null,
  );
  const zoomId = useId();
  const helpId = useId();

  // 元画像を読む。`from-image` で端末の向きを反映した大きさになる。
  useEffect(() => {
    let cancelled = false;
    // 片付けのときに引き直さないよう、いま描いている canvas を控える。
    const canvas = canvasRef.current;
    setStatus("loading");
    setZoom(MIN_ZOOM);
    setOffset({ x: 0, y: 0 });
    createImageBitmap(file, { imageOrientation: "from-image" })
      .then((bitmap) => {
        if (cancelled) {
          bitmap.close();
          return;
        }
        bitmapRef.current = bitmap;
        setNatural({ width: bitmap.width, height: bitmap.height });
        setStatus("ready");
      })
      .catch(() => {
        if (!cancelled) setStatus("error");
      });
    // 閉じたとき（アンマウント）と画像を選び直したときに、画素をすぐ手放す。
    return () => {
      cancelled = true;
      bitmapRef.current?.close();
      bitmapRef.current = null;
      if (canvas) {
        canvas.width = 0;
        canvas.height = 0;
      }
    };
  }, [file]);

  // 枠の実寸を測る。狭い画面では幅に合わせて高さが決まるので、倍率の計算に実寸が要る。
  useEffect(() => {
    const node = frameRef.current;
    if (!node) return;
    const measure = () => {
      const rect = node.getBoundingClientRect();
      setFrame((current) =>
        current.width === rect.width && current.height === rect.height
          ? current
          : { width: rect.width, height: rect.height },
      );
    };
    measure();
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", measure);
      return () => window.removeEventListener("resize", measure);
    }
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const ready = status === "ready" && frame.width > 0 && frame.height > 0;

  /** 拡大の上限。800px を割らない範囲と `MAX_ZOOM` の小さいほう。 */
  const sliderMax = ready
    ? Math.max(
        MIN_ZOOM,
        Math.min(
          MAX_ZOOM,
          Math.floor(maxZoomForMinCrop(natural.width, natural.height, frame.width, frame.height, MIN_HEADER_CROP_WIDTH) * 10) / 10,
        ),
      )
    : MAX_ZOOM;

  // 枠の幅が変わって上限が下がったときは、いまの倍率を上限へ寄せる。
  useEffect(() => {
    if (zoom > sliderMax) setZoom(sliderMax);
  }, [zoom, sliderMax]);

  /** 800px を割る切り出しか。割るときは確定を止めて理由を出す。 */
  const largeEnough =
    ready && isCropLargeEnough(natural.width, natural.height, frame.width, frame.height, zoom, MIN_HEADER_CROP_WIDTH);

  /** 倍率を変える。枠の中心にある画素は動かさない。 */
  const changeZoom = (next: number) => {
    if (!ready) return;
    const to = Math.min(sliderMax, Math.max(MIN_ZOOM, next));
    const moved = zoomAroundCenter({
      naturalW: natural.width,
      naturalH: natural.height,
      frameW: frame.width,
      frameH: frame.height,
      fromZoom: zoom,
      toZoom: to,
      offsetX: offset.x,
      offsetY: offset.y,
    });
    setZoom(to);
    setOffset({ x: moved.offsetX, y: moved.offsetY });
  };

  // 枠へ描く。ずらし幅は描く直前にも収めるので、枠の大きさが変わっても隙間が出ない。
  useEffect(() => {
    const canvas = canvasRef.current;
    const bitmap = bitmapRef.current;
    if (!canvas || !bitmap || !ready) return;
    const ratio = Math.min(window.devicePixelRatio || 1, MAX_DEVICE_PIXEL_RATIO);
    canvas.width = Math.round(frame.width * ratio);
    canvas.height = Math.round(frame.height * ratio);
    const context = canvas.getContext("2d");
    if (!context) return;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, frame.width, frame.height);

    const scale = coverScale(natural.width, natural.height, frame.width, frame.height) * zoom;
    const drawW = natural.width * scale;
    const drawH = natural.height * scale;
    const offsetX = clampOffset(offset.x, drawW, frame.width);
    const offsetY = clampOffset(offset.y, drawH, frame.height);
    context.imageSmoothingQuality = "high";
    context.drawImage(bitmap, (frame.width - drawW) / 2 + offsetX, (frame.height - drawH) / 2 + offsetY, drawW, drawH);
  }, [ready, frame.width, frame.height, natural.width, natural.height, zoom, offset.x, offset.y]);

  const startDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!ready || busy) return;
    // 取れない端末（合成の pointer など）でも、位置の追従だけは続けられるようにする。
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // 捕捉できなくても、枠の上の移動は拾える。
    }
    dragRef.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      offsetX: offset.x,
      offsetY: offset.y,
    };
  };

  const moveDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const scale = coverScale(natural.width, natural.height, frame.width, frame.height) * zoom;
    setOffset({
      x: clampOffset(drag.offsetX + (event.clientX - drag.x), natural.width * scale, frame.width),
      y: clampOffset(drag.offsetY + (event.clientY - drag.y), natural.height * scale, frame.height),
    });
  };

  const endDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  // 位置はドラッグだけでなく矢印キーでも動かせるようにする。
  const nudge = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!ready) return;
    const step = event.shiftKey ? NUDGE * 3 : NUDGE;
    const dx = event.key === "ArrowLeft" ? -step : event.key === "ArrowRight" ? step : 0;
    const dy = event.key === "ArrowUp" ? -step : event.key === "ArrowDown" ? step : 0;
    if (dx === 0 && dy === 0) return;
    event.preventDefault();
    const scale = coverScale(natural.width, natural.height, frame.width, frame.height) * zoom;
    setOffset((current) => ({
      x: clampOffset(current.x + dx, natural.width * scale, frame.width),
      y: clampOffset(current.y + dy, natural.height * scale, frame.height),
    }));
  };

  const confirm = () => {
    const bitmap = bitmapRef.current;
    if (!bitmap || !ready || !largeEnough || busy || processing) return;
    const rect = cropSourceRect({
      naturalW: natural.width,
      naturalH: natural.height,
      frameW: frame.width,
      frameH: frame.height,
      zoom,
      offsetX: offset.x,
      offsetY: offset.y,
    });
    // 元画像より大きくは作らない。3200px を超えるときだけ縮める。
    const shrunk = Math.min(1, MAX_OUTPUT_WIDTH / rect.width);
    const outputW = Math.max(1, Math.round(rect.width * shrunk));
    const outputH = Math.max(1, Math.round(rect.height * shrunk));

    const canvas = document.createElement("canvas");
    canvas.width = outputW;
    canvas.height = outputH;
    const context = canvas.getContext("2d");
    if (!context) {
      setLocalError("画像を作れませんでした。選び直してください。");
      return;
    }
    context.imageSmoothingQuality = "high";
    context.drawImage(bitmap, rect.x, rect.y, rect.width, rect.height, 0, 0, outputW, outputH);

    setProcessing(true);
    setLocalError(null);
    canvas.toBlob(
      (blob) => {
        setProcessing(false);
        // 送り終わるまで画素を持たない。
        canvas.width = 0;
        canvas.height = 0;
        if (!blob) {
          setLocalError("画像を作れませんでした。選び直してください。");
          return;
        }
        onConfirm(blob);
      },
      "image/jpeg",
      OUTPUT_QUALITY,
    );
  };

  const message = error ?? localError;
  const disabled = busy || processing || status !== "ready";

  return (
    <Dialog
      title="ヘッダー画像を切り抜く"
      titleId="header-crop-title"
      // 送信中は閉じ道を消す（送った画像が届いたか分からないまま消さない）。
      onClose={busy ? undefined : onCancel}
      closeLabel="切り抜きをやめる"
      actions={
        <>
          <button
            type="button"
            className="btn btn--primary btn--block"
            onClick={confirm}
            disabled={disabled || !largeEnough}
          >
            {busy ? "保存しています…" : processing ? "準備しています…" : "この範囲で決定"}
          </button>
          <button type="button" className="btn btn--ghost btn--block" onClick={onCancel} disabled={busy}>
            やめる
          </button>
        </>
      }
    >
      <div className="header-crop">
        <div
          ref={frameRef}
          className="header-crop__frame"
          role="group"
          aria-label="切り抜く位置"
          aria-describedby={helpId}
          tabIndex={0}
          onPointerDown={startDrag}
          onPointerMove={moveDrag}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onKeyDown={nudge}
        >
          <canvas ref={canvasRef} className="header-crop__canvas" aria-hidden="true" />
          {status === "loading" && <span className="header-crop__status">画像を読み込んでいます…</span>}
          {status === "error" && <span className="header-crop__status">この画像は開けませんでした。</span>}
        </div>

        <div className="header-crop__zoom">
          <label className="label" htmlFor={zoomId}>
            拡大
          </label>
          <input
            id={zoomId}
            className="header-crop__range"
            type="range"
            min={MIN_ZOOM}
            max={sliderMax}
            step={0.1}
            value={zoom}
            aria-valuetext={`${zoom.toFixed(1)}倍`}
            disabled={disabled}
            onChange={(event) => changeZoom(Number(event.target.value))}
          />
          <output className="header-crop__value" htmlFor={zoomId}>
            {zoom.toFixed(1)}倍
          </output>
        </div>

        <p id={helpId} className="dialog__body header-crop__help">
          ドラッグか矢印キーで位置を決めます。
        </p>
        <p className="dialog__note">幅800px未満になる範囲は選べません。</p>
        {!largeEnough && status === "ready" && (
          <p className="field-error" role="alert">
            画像が小さいため切り出せません。幅800px以上の画像を選んでください。
          </p>
        )}
        {message && (
          <p className="field-error" role="alert">
            {message}
          </p>
        )}
      </div>
    </Dialog>
  );
}
