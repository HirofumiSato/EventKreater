import { voiceFieldByKey, voiceFieldLabel } from "@/modules/events/lib/voice/fields";
import type { VoiceFieldKey } from "@/modules/events/lib/voice/types";

/**
 * 認識モデルへ渡すプロンプト。DOM も Next も読まない純ロジック。
 *
 * 1 行目で「日本語」と「どの欄か」を明示し、`language=ja` と重ねて英語へ流れるのを抑える。
 * 2 行目は欄ごとの語彙（`fields.ts` の `hint` が唯一の出どころ）。3 行目で説明の足し算を止め、
 * 4 行目で数字の表記を固定する。5 行目は入力済みの催し名・会場名を当て字の手掛かりとして置く。
 * 利用者の自由文はそのまま連結せず、改行と制御文字を潰してから差し込む。
 */

/** プロンプトの上限。超えたら後ろの手掛かりから落とす。 */
export const VOICE_PROMPT_MAX = 700;

export interface VoicePromptInput {
  /** 聞いている欄。null なら欄を決めない汎用文にする。 */
  field: VoiceFieldKey | null;
  /** 行の番号。「2件目の開催日」「女性の金額」の言い方に使う。 */
  row?: number;
  /** 入力済みの催し名。固有名詞の当て字を寄せるためだけに使う。 */
  title?: string | null;
  /** 入力済みの会場名。地名・建物名の当て字を寄せるためだけに使う。 */
  venueName?: string | null;
}

/** 改行と制御文字を空白へ潰し、連続する空白を 1 つにする。 */
function cleanClue(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const text = value
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return text ? text : null;
}

/** 当て字の手掛かり。どちらも無ければ行ごと落とす。 */
function clueLine(title: string | null, venueName: string | null): string | null {
  if (!title && !venueName) return null;
  const subject = [title ? `催し名は「${title}」` : "", venueName ? `会場は「${venueName}」` : ""]
    .filter(Boolean)
    .join("、");
  return `入力済みの${subject}です。同じ読みの語はこの表記に寄せてください。`;
}

function joinLines(lines: ReadonlyArray<string | null>): string {
  return lines.filter((line): line is string => Boolean(line)).join("\n");
}

/** 欄と行、入力済みの値から、モデルへ渡す 1 本のプロンプトを組み立てる。 */
export function buildVoicePrompt(input: VoicePromptInput): string {
  const requested = input.row ?? 0;
  const row = Number.isInteger(requested) && requested >= 0 ? requested : 0;
  const field = input.field ? voiceFieldByKey(input.field) : null;
  const label = field ? voiceFieldLabel(field.key, row) : null;

  const head = label
    ? `日本語の音声を、イベント作成フォームの「${label}」に入れる値として書き起こしてください。`
    : "日本語の音声を、イベント作成フォームに入れる値として書き起こしてください。";
  const vocab = field ? `${field.hint}。` : null;
  const noFiller = "話した語だけを書き、説明や句読点は足さないでください。";
  const numbers = "数字は算用数字にし、単位（円・人・日・時）は話したとおりに残してください。";
  const clues = clueLine(cleanClue(input.title), cleanClue(input.venueName));

  const lines: Array<string | null> = [head, vocab, noFiller, numbers, clues];
  let prompt = joinLines(lines);
  // 後ろの手掛かり（当て字 → 欄の語彙）から落とす。1 行目は必ず残す。
  if (prompt.length > VOICE_PROMPT_MAX && clues) {
    lines[4] = null;
    prompt = joinLines(lines);
  }
  if (prompt.length > VOICE_PROMPT_MAX && vocab) {
    lines[1] = null;
    prompt = joinLines(lines);
  }
  return prompt.length > VOICE_PROMPT_MAX ? prompt.slice(0, VOICE_PROMPT_MAX) : prompt;
}
