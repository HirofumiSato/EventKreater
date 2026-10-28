import type { EventFormValues } from "@/modules/events/types";

/**
 * ログイン前に入力した内容の退避先。
 *
 * 作成には会員登録が要るため、作成画面は入力を確かめてからログインへ送る。
 * その往復で入力と作成中のチラシを失わないよう、`sessionStorage` に 1 件だけ置く。
 * サーバーへは置かない（ログイン前に下書きを溜められないようにするため）。
 */
const STORAGE_KEY = "event:pending-form";

/**
 * 使うのは `sessionStorage` の 3 つだけ。テストで差し替えられるよう型を絞る。
 */
export type PendingFormStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export interface PendingForm {
  form: EventFormValues;
  /** 作成中のチラシの画像 URL。復元しても同じ絵を出せるように持つ。 */
  flyerPreview: string | null;
  /** 保存した時刻。いつ入れた内容かを伝えるために残す。 */
  savedAt: string;
}

function defaultStorage(): PendingFormStorage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage;
  } catch {
    // プライベートモードなどで触れないことがある。退避できなくても画面は続けられる。
    return null;
  }
}

/**
 * 登録・ログインへ送る直前に呼ぶ。書けなくても遷移は止めない。
 */
export function savePendingForm(
  form: EventFormValues,
  flyerPreview: string | null,
  storage: PendingFormStorage | null = defaultStorage(),
): void {
  if (!storage) return;
  const pending: PendingForm = { form, flyerPreview, savedAt: new Date().toISOString() };
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(pending));
  } catch {
    // 容量超過などで書けないことがある。入力は画面に残っているので、そのまま進める。
  }
}

/** 退避した内容を読む。形が違う値は捨て、空のフォームで上書きしない。 */
export function readPendingForm(
  storage: PendingFormStorage | null = defaultStorage(),
): PendingForm | null {
  if (!storage) return null;
  let raw: string | null;
  try {
    raw = storage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<PendingForm> | null;
    if (!parsed || typeof parsed !== "object") return null;
    if (!parsed.form || typeof parsed.form !== "object") return null;
    if (typeof parsed.savedAt !== "string") return null;
    return {
      form: parsed.form as EventFormValues,
      flyerPreview: typeof parsed.flyerPreview === "string" ? parsed.flyerPreview : null,
      savedAt: parsed.savedAt,
    };
  } catch {
    return null;
  }
}

export function clearPendingForm(storage: PendingFormStorage | null = defaultStorage()): void {
  if (!storage) return;
  try {
    storage.removeItem(STORAGE_KEY);
  } catch {
    // 消せなくても、次に復元したときに上書きされる。
  }
}

/** 取り出して消す。復元は 1 回だけにして、別の用事で開いたときに古い内容を出さない。 */
export function takePendingForm(
  storage: PendingFormStorage | null = defaultStorage(),
): PendingForm | null {
  const pending = readPendingForm(storage);
  if (pending) clearPendingForm(storage);
  return pending;
}
