"use client";

import { useRef, useState } from "react";
import { readProblem } from "@/lib/problem";
import { MAX_AVATAR_BYTES, UPLOAD_ACCEPT } from "@/lib/image-upload";
import { profileInitial } from "@/modules/organizers/lib/profile";

interface OrganizerAvatarFieldProps {
  /** 頭文字を出すときの表示名。 */
  name: string;
  /** いま設定されているアイコン。未設定は null。 */
  avatarUrl: string | null;
  /** 設定・削除が成功したときに、新しい URL（外したときは null）を返す。 */
  onChange: (avatarUrl: string | null) => void;
  /** 成功を伝える短い文言。画面のトーストが受け取る。 */
  onMessage: (message: string) => void;
}

const AVATAR_ENDPOINT = "/api/v1/organizer/profile/avatar";

/**
 * 公開プロフィールのアイコン（SCR-ORG-14）。
 *
 * 選んだ時点で保存する。本文の「保存する」を押す前に反映されるので、
 * 「選ぶとすぐに保存されます」と明記する。サーバーが WebP へ作り直すため、
 * 送る前の検査は大きさだけにする（形式の判定はサーバーが正）。
 */
export function OrganizerAvatarField({
  name,
  avatarUrl,
  onChange,
  onMessage,
}: OrganizerAvatarFieldProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const select = async (file: File) => {
    if (busy) return;
    setError(null);
    if (file.size > MAX_AVATAR_BYTES) {
      setError("アイコン画像は4MB以下にしてください。");
      return;
    }
    setBusy(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const response = await fetch(AVATAR_ENDPOINT, { method: "POST", body: form });
      if (!response.ok) throw new Error(await readProblem(response));
      const data = (await response.json()) as { avatarUrl: string | null };
      onChange(data.avatarUrl);
      onMessage("アイコンを変更しました。");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "アイコンを変更できませんでした。");
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const remove = async () => {
    if (busy) return;
    setError(null);
    setBusy(true);
    try {
      const response = await fetch(AVATAR_ENDPOINT, { method: "DELETE" });
      if (!response.ok) throw new Error(await readProblem(response));
      onChange(null);
      onMessage("アイコンを外しました。");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "アイコンを外せませんでした。");
    } finally {
      setBusy(false);
    }
  };

  return (
    <fieldset className="field">
      <legend className="label">アイコン画像</legend>
      <div className="avatar-field">
        <span className="avatar-field__preview">
          {avatarUrl ? (
            // 大きさは枠が決める。比率のずれは object-fit で吸収する。
            <img src={avatarUrl} alt="" width={80} height={80} decoding="async" />
          ) : (
            <span aria-hidden="true">{profileInitial(name)}</span>
          )}
        </span>
        <div className="avatar-field__body">
          <div className="btn-row">
            <button
              type="button"
              className="btn btn--outline btn--sm"
              disabled={busy}
              onClick={() => inputRef.current?.click()}
            >
              {busy ? "処理しています…" : avatarUrl ? "画像を変える" : "画像を選ぶ"}
            </button>
            {avatarUrl && (
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
            選ぶとすぐに保存されます。正方形に切り抜いて表示します（JPEG / PNG / WebP・4MBまで）。
          </p>
          {error && <p className="field-error">{error}</p>}
        </div>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept={UPLOAD_ACCEPT}
        className="visually-hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void select(file);
        }}
      />
    </fieldset>
  );
}
