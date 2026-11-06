/**
 * 初回ガイド（コーチマーク）を出すかどうかの記憶。
 *
 * 画面から切り離した純ロジックにして、`localStorage` が無い環境や、
 * 参照しただけで例外を投げる環境（Safari のプライベートモードなど）でも
 * 落ちないようにする。保存できなければ「毎回出す」に倒す。
 */

/** 覚えておくキー。アプリ名は `eventkreater`（画面の表記とは別に、保存名はこの綴りで固定する）。 */
export const VOICE_GUIDE_STORAGE_KEY = "eventkreater.voice-guide.dismissed";

/** 保存先。テストから差し替えられるよう、必要な 3 つだけを受け取る。 */
export interface VoiceGuideStorage {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
}

/**
 * 保存先を取る。`localStorage` への参照そのものが例外になる環境があるため、
 * 参照も try/catch の中に入れる。
 */
function guideStorage(): VoiceGuideStorage | null {
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
export function isVoiceGuideDismissed(): boolean {
  try {
    return guideStorage()?.getItem(VOICE_GUIDE_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

/**
 * 初回ガイドを閉じたことを覚える。次に開いたときの自動表示を止める。
 * 手でマイクを押したときはこの記憶を見ないので、入口は塞がない。
 * 保存できない環境でも例外は投げない（毎回出すだけ）。
 */
export function dismissVoiceGuide(): void {
  try {
    guideStorage()?.setItem(VOICE_GUIDE_STORAGE_KEY, "1");
  } catch {
    // 保存できない環境では、次に開いたときにもう一度出るだけ。
  }
}
