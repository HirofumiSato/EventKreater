/**
 * 主催者マイページの操作ガイドを、初回だけ自動で出すかどうかの記憶。
 *
 * 形はイベント作成のガイド（`src/modules/events/lib/tour/memory.ts`）とそろえる。
 * ただしキーは別に持つ。どちらかを閉じただけで、もう片方の案内まで二度と出なくなるのは困る。
 * （音声ガイドの `eventkreater.voice-guide.dismissed` とも別。）
 *
 * `localStorage` が無い環境や、参照しただけで例外を投げる環境（Safari のプライベートモードなど）
 * でも落とさない。保存できなければ「毎回出す」に倒す。
 */

/** 覚えておくキー。アプリ名の綴りは音声ガイド・イベント作成ガイドとそろえる。 */
export const MYPAGE_GUIDE_STORAGE_KEY = "eventkreater.mypage-guide.dismissed";

/** 保存先。テストから差し替えられるよう、必要な 3 つだけを受け取る。 */
export interface MyPageGuideStorage {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
}

/**
 * 保存先を取る。`localStorage` への参照そのものが例外になる環境があるため、
 * 参照も try/catch の中に入れる。
 */
function guideStorage(): MyPageGuideStorage | null {
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
export function isMyPageGuideDismissed(): boolean {
  try {
    return guideStorage()?.getItem(MYPAGE_GUIDE_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

/**
 * ガイドを閉じたことを覚える。次に開いたときの自動表示を止める。
 * 記憶を消す道は作らない。開き直したい人は右上の「使い方」から開ける。
 * 保存できない環境でも例外は投げない（毎回出すだけ）。
 */
export function dismissMyPageGuide(): void {
  try {
    guideStorage()?.setItem(MYPAGE_GUIDE_STORAGE_KEY, "1");
  } catch {
    // 保存できない環境では、次に開いたときにもう一度出るだけ。
  }
}
