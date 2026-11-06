/**
 * 初回ガイド（スポットライトツアー）を出すかどうかの記憶。
 *
 * 音声ガイド（`src/modules/events/lib/voice/guide.ts`）と同じ形にする。ただしキーは別に持つ。
 * ツアーを閉じただけで音声ガイドまで消えると、機能の案内が二度と出なくなるため。
 *
 * `localStorage` が無い環境や、参照しただけで例外を投げる環境（Safari のプライベートモードなど）
 * でも落とさない。保存できなければ「毎回出す」に倒す。
 */

/** 覚えておくキー。アプリ名の綴りは音声ガイドとそろえる。 */
export const EVENT_GUIDE_STORAGE_KEY = "eventkreater.event-guide.dismissed";

/** 保存先。テストから差し替えられるよう、必要な 3 つだけを受け取る。 */
export interface EventGuideStorage {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
}

/**
 * 保存先を取る。`localStorage` への参照そのものが例外になる環境があるため、
 * 参照も try/catch の中に入れる。
 */
function guideStorage(): EventGuideStorage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

/**
 * 初回ガイドを閉じたことを覚えているか。
 * 覚えていない・読めないときは false（＝次に開いたときも出す）。
 */
export function isEventGuideDismissed(): boolean {
  try {
    return guideStorage()?.getItem(EVENT_GUIDE_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

/**
 * 初回ガイドの記憶を書き換える。
 * `permanent` が true なら「次回から表示しない」を覚え、false なら記憶を消して次回も出す。
 * 保存できない環境でも例外は投げない（毎回出すだけ）。
 */
export function dismissEventGuide(permanent = true): void {
  try {
    const storage = guideStorage();
    if (!storage) return;
    if (permanent) storage.setItem(EVENT_GUIDE_STORAGE_KEY, "1");
    else storage.removeItem(EVENT_GUIDE_STORAGE_KEY);
  } catch {
    // 保存できない環境では、次に開いたときにもう一度出るだけ。
  }
}
