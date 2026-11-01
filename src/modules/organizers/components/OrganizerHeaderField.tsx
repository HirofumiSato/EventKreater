"use client";

import { useRef, useState } from "react";
import { readProblem } from "@/lib/problem";
import { MAX_HEADER_BYTES, UPLOAD_ACCEPT } from "@/lib/image-upload";
import { ImageCropDialog } from "@/modules/organizers/components/ImageCropDialog";

interface OrganizerHeaderFieldProps {
  /** いま設定されているヘッダー画像。未設定は null。 */
  headerUrl: string | null;
  /** 設定・削除が成功したときに、新しい URL（外したときは null）を返す。 */
  onChange: (headerUrl: string | null) => void;
  /** 成功を伝える短い文言。画面のトーストが受け取る。 */
  onMessage: (message: string) => void;
}

const HEADER_ENDPOINT = "/api/v1/organizer/profile/header";

/**
 * 公開プロフィールのヘッダー画像（SCR-ORG-14）。
 *
 * アイコンと同じく、選んだ時点で保存する。ただし縦横比が 3:1 と決まっているので、
 * 送る前に切り抜き画面（`ImageCropDialog`）で位置と倍率を決めてもらう。
 * 選んだだけでは送らず、切り抜きを確定してから `POST` する。
 */
export function OrganizerHeaderField({ headerUrl, onChange, onMessage }: OrganizerHeaderFieldProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** 切り抜き中のファイル。null のときはダイアログを出さない。 */
  const [cropFile, setCropFile] = useState<File | null>(null);
  /** 送信に失敗した理由。ダイアログの中に出す。 */
  const [cropError, setCropError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const pick = (file: File) => {
    if (busy) return;
    setError(null);
    if (file.size > MAX_HEADER_BYTES) {
      setError("ヘッダー画像は8MB以下にしてください。");
      return;
    }
    // ここでは送らない。切り抜きを確定してから送る。
    setCropError(null);
    setCropFile(file);
  };

  const upload = async (blob: Blob) => {
    setBusy(true);
    setCropError(null);
    try {
      const form = new FormData();
      form.append("file", new File([blob], "header.jpg", { type: "image/jpeg" }));
      const response = await fetch(HEADER_ENDPOINT, { method: "POST", body: form });
      if (!response.ok) throw new Error(await readProblem(response));
      const data = (await response.json()) as { headerUrl: string | null };
      onChange(data.headerUrl);
      onMessage("ヘッダー画像を変更しました。");
      setCropFile(null);
    } catch (cause) {
      setCropError(cause instanceof Error ? cause.message : "ヘッダー画像を変更できませんでした。");
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (busy) return;
    setError(null);
    setBusy(true);
    try {
      const response = await fetch(HEADER_ENDPOINT, { method: "DELETE" });
      if (!response.ok) throw new Error(await readProblem(response));
      onChange(null);
      onMessage("ヘッダー画像を外しました。");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "ヘッダー画像を外せませんでした。");
    } finally {
      setBusy(false);
    }
  };

  const closeCrop = () => {
    if (busy) return;
    setCropFile(null);
    setCropError(null);
    if (inputRef.current) inputRef.current.value = "";
  };

  return (
    <fieldset className="field">
      <legend className="label">ヘッダー画像</legend>
      <div className="header-field">
        <span className="header-field__preview">
          {headerUrl ? (
            // 大きさは枠が決める。比率のずれは object-fit で吸収する。
            <img src={headerUrl} alt="" width={1920} height={640} decoding="async" />
          ) : (
            <span>まだ設定していません</span>
          )}
        </span>
        <div className="header-field__body">
          <div className="btn-row">
            <button
              type="button"
              className="btn btn--outline btn--sm"
              disabled={busy}
              onClick={() => inputRef.current?.click()}
            >
              {busy ? "処理しています…" : headerUrl ? "画像を変える" : "画像を選ぶ"}
            </button>
            {headerUrl && (
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                disabled={busy}
                onClick={() => void remove()}
              >
                削除
              </button>
            )}
          </div>
          <p className="help">
            選ぶとすぐに保存されます。公開中のみ表示されます（JPEG / PNG / WebP・8MBまで）。
          </p>
          {error && <p className="field-error">{error}</p>}
        </div>
      </div>
      {/* 同じファイルを選び直せるよう、読んだ時点で値を空に戻す。 */}
      <input
        ref={inputRef}
        type="file"
        accept={UPLOAD_ACCEPT}
        className="visually-hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) pick(file);
        }}
      />
      {cropFile && (
        <ImageCropDialog
          file={cropFile}
          busy={busy}
          error={cropError}
          onCancel={closeCrop}
          onConfirm={(blob) => void upload(blob)}
        />
      )}
    </fieldset>
  );
}
