import type { EventFormValues } from "@/modules/events/types";

/**
 * ログイン前に入力した内容の退避先。
 *
 * 作成には会員登録が要るため、作成画面は入力を確かめてからログインへ送る。
 * その往復で入力と作成中のチラシを失わないよう、`localStorage` に 1 件だけ置く。
 * スマホのメールアプリが別タブで開いても読めるよう、`sessionStorage` ではなく
 * 同じブラウザの別タブまで共有する `localStorage` を使う。24時間で失効する。
 * サーバーへは置かない（ログイン前に下書きを溜められないようにするため）。
 */
const STORAGE_KEY = "event:pending-form";

/** 退避の寿命。確認メールのリンク（24時間）に合わせる。 */
export const PENDING_FORM_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * 使うのは `getItem` / `setItem` / `removeItem` の 3 つだけ。テストで差し替えられるよう型を絞る。
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
    return window.localStorage;
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
    const savedAt = Date.parse(parsed.savedAt);
    // 時刻として読めない値は、いつ書いたか分からないので捨てる。
    if (Number.isNaN(savedAt)) {
      clearPendingForm(storage);
      return null;
    }
    // 24時間を過ぎた内容は、入力の続きとして出さない（開いたときに驚かせないため）。
    // 未来の時刻は端末の時計ずれとして読み、捨てない。
    if (Date.now() - savedAt > PENDING_FORM_TTL_MS) {
      clearPendingForm(storage);
      return null;
    }
    // 割引を足す前に退避した内容には `discounts` が無い。無いまま復元すると
    // 送信時に undefined を触るので、ここで空配列に正規化する。
    const form = parsed.form as EventFormValues;
    return {
      form: {
        ...form,
        discounts: Array.isArray(form.discounts) ? form.discounts : [],
        // 概要を足す前に退避した内容には `summary` が無い。無いまま復元すると
        // 概要欄が undefined になるので、空文字に正規化する。
        summary: typeof form.summary === "string" ? form.summary : "",
      },
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
