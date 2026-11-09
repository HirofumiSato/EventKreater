/**
 * 主催者マイページの操作ガイドを、画面をまたいで続けるための記憶。
 *
 * ガイドは `/mypage` → `/organizer/events` → `/mypage` と移る。ページを移ると
 * 部品も作り直されるので、どの枚まで進んだかを `sessionStorage` に残し、
 * 移った先の同じ部品が続きから出す。
 *
 * `localStorage` ではなく `sessionStorage` を使う。続きはタブを閉じるまでの一時的なもので、
 * 次に開いたときに途中の枚から始まると、何の案内か分からないまま画面が動くため。
 * 10 分で失効させ、途中でやめたまま別の用事をして戻ってきたときも再開しない。
 *
 * 参照先は `steps.ts` の一方向だけにする（知っているキーの正は向こう 1 か所）。
 * `sessionStorage` が無い環境や、参照しただけで例外を投げる環境でも落とさない。
 */

import { myPageGuideStep, type MyPageGuideKey } from "@/modules/organizers/lib/tour/steps";

/** 続きを置くキー。イベント作成ガイドの記憶とは別に持つ。 */
export const MYPAGE_GUIDE_SESSION_KEY = "eventkreater.mypage-guide.session";

/** 続きの寿命。これを過ぎた続きは捨て、最初から出し直す。 */
export const MYPAGE_GUIDE_SESSION_TTL_MS = 10 * 60 * 1000;

/** どの枚まで進んだかを、いつ書いたかと一緒に持つ。 */
export interface MyPageGuideSession {
  step: MyPageGuideKey;
  at: number;
}

/** 保存先。テストから差し替えられるよう、必要な 3 つだけを受け取る。 */
export interface MyPageGuideSessionStorage {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
}

/**
 * 保存先を取る。`sessionStorage` への参照そのものが例外になる環境があるため、
 * 参照も try/catch の中に入れる。
 */
function sessionStore(): MyPageGuideSessionStorage | null {
  try {
    return globalThis.sessionStorage ?? null;
  } catch {
    return null;
  }
}

/** 壊れた値・古い値を捨てる。捨てられなくても、次に読んだときにまた捨てる。 */
function discardSession(storage: MyPageGuideSessionStorage): void {
  try {
    storage.removeItem(MYPAGE_GUIDE_SESSION_KEY);
  } catch {
    // 消せない環境では、次に読んだときにまた捨てる。
  }
}

/**
 * 知っているキーか。キーの一覧は `steps.ts` に置いたままにするため、
 * ここで配列を持たずに `myPageGuideStep` に聞く（知らないキーは例外になる）。
 */
function isKnownStep(value: unknown): value is MyPageGuideKey {
  if (typeof value !== "string") return false;
  try {
    myPageGuideStep(value as MyPageGuideKey);
    return true;
  } catch {
    return false;
  }
}

/**
 * 続きを読む。次のどれかなら `null` を返し、壊れた値は捨てる。
 *
 * - 読めない（保存先が無い・参照で例外になる）
 * - JSON が壊れている
 * - `step` が知らないキー（枚を減らしたあとの古い続きなど）
 * - `at` が数値でない
 * - 書いてから 10 分を過ぎている
 */
export function readMyPageGuideSession(): MyPageGuideSession | null {
  const storage = sessionStore();
  if (!storage) return null;

  let raw: string | null;
  try {
    raw = storage.getItem(MYPAGE_GUIDE_SESSION_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    discardSession(storage);
    return null;
  }

  if (typeof parsed !== "object" || parsed === null) {
    discardSession(storage);
    return null;
  }

  const candidate = parsed as { step?: unknown; at?: unknown };
  if (!isKnownStep(candidate.step)) {
    discardSession(storage);
    return null;
  }
  if (typeof candidate.at !== "number" || !Number.isFinite(candidate.at)) {
    discardSession(storage);
    return null;
  }
  if (Date.now() - candidate.at > MYPAGE_GUIDE_SESSION_TTL_MS) {
    discardSession(storage);
    return null;
  }

  return { step: candidate.step, at: candidate.at };
}

/**
 * 続きを書く。枚を進めるたびに上書きし、`at` もその都度新しくする
 * （長く読んでいるだけの続きが途中で失効しないよう、進んだ時点を寿命の起点にする）。
 * 書けない環境でも例外は投げない（画面をまたぐ続きが出せないだけ）。
 */
export function writeMyPageGuideSession(step: MyPageGuideKey): void {
  try {
    sessionStore()?.setItem(MYPAGE_GUIDE_SESSION_KEY, JSON.stringify({ step, at: Date.now() }));
  } catch {
    // 保存できない環境では、移った先でガイドが続かないだけ。
  }
}

/** 続きを消す。閉じたとき・最後まで進んだとき・別の画面へ移ったときに呼ぶ。 */
export function clearMyPageGuideSession(): void {
  const storage = sessionStore();
  if (!storage) return;
  discardSession(storage);
}
