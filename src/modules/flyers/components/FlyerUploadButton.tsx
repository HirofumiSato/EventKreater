"use client";

import { useRef, useState } from "react";
import { readProblem } from "@/lib/problem";
import { MAX_IMAGE_BYTES, UPLOAD_ACCEPT } from "@/modules/flyers/lib/upload";
import type { SelectableFlyer } from "@/modules/flyers/types";

interface FlyerUploadButtonProps {
  /** チラシ選択モーダルでの表示名に使うイベント名。未入力でも空文字で送る。 */
  title: string;
  disabled?: boolean;
  onUploaded: (flyer: SelectableFlyer) => void;
  onError: (message: string | null) => void;
}

/**
 * 手元のチラシ画像をそのままアセットにする。生成ではないので回数は消費しない。
 * 形式と上限はサーバーでも検証するが、8MB だけは送る前に弾いて待ち時間を省く。
 */
export function FlyerUploadButton({
  title,
  disabled = false,
  onUploaded,
  onError,
}: FlyerUploadButtonProps) {
  const [uploading, setUploading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const upload = async (file: File) => {
    if (uploading) return;
    onError(null);
    if (file.size > MAX_IMAGE_BYTES) {
      onError("画像は8MB以下にしてください。");
      return;
    }
    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("title", title);
      const response = await fetch("/api/v1/flyer-assets", {
        method: "POST",
        body: form,
      });
      if (!response.ok) throw new Error(await readProblem(response));
      const data = (await response.json()) as { flyerAsset: SelectableFlyer };
      onUploaded(data.flyerAsset);
    } catch (cause) {
      onError(
        cause instanceof Error ? cause.message : "画像をアップロードできませんでした",
      );
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  return (
    <>
      <button
        type="button"
        className="btn btn--ghost btn--sm"
        disabled={disabled || uploading}
        onClick={() => inputRef.current?.click()}
      >
        {uploading ? "読み込んでいます…" : "画像をアップロードして使う"}
      </button>
      <input
        ref={inputRef}
        type="file"
        accept={UPLOAD_ACCEPT}
        className="visually-hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void upload(file);
        }}
      />
    </>
  );
}
