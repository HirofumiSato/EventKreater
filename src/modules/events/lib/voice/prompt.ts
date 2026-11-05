import { voiceFieldByKey, voiceFieldLabel } from "@/modules/events/lib/voice/fields";
import type { VoiceField, VoiceFieldKey } from "@/modules/events/lib/voice/types";

/**
 * 認識モデルへ渡す文脈と語彙。DOM も Next も読まない純ロジック。
 *
 * OpenAI の文字起こし API の `prompt` は指示文ではなく「記録についての文脈」である。
 * そのため `buildVoicePrompt` は「どの画面の、どの欄を話しているか」だけを短く置き、
 * 語彙は `keywords`（`buildVoiceKeywords`）へ分ける。指示文や数字表記の命令は置かない。
 */

/** プロンプトの上限。超えたら後ろの手掛かりから落とす。 */
export const VOICE_PROMPT_MAX = 700;

/** `keywords` に渡す語の上限。入れすぎると幻聴するため、欄ごとに絞る。 */
export const VOICE_KEYWORDS_MAX = 20;

/** 1 語の長さの上限。長い文を語彙として送らない。 */
export const VOICE_KEYWORD_MAX_LENGTH = 60;

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

/** `keywords` に混ぜる入力済みの値。いま聞いている欄の現在値は渡さない。 */
export interface VoiceKeywordInput {
  /** 入力済みの催し名。 */
  title?: string | null;
  /** 入力済みの会場名。 */
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
  // 「〜してください」は書かない。API の `prompt` は指示ではなく文脈として読まれる。
  return `入力済みの${subject}です。`;
}

/**
 * 語彙 1 語を整える。API は `<` `>` と改行を含む `keywords` をリクエストごと拒否するため、
 * ここで落としてから送る。空になった語は捨て、長すぎる語は 60 文字で切る。
 */
function cleanKeyword(value: string): string | null {
  const text = value
    .replace(/[<>\r\n]/g, "")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .trim();
  if (!text) return null;
  return text.length > VOICE_KEYWORD_MAX_LENGTH
    ? text.slice(0, VOICE_KEYWORD_MAX_LENGTH)
    : text;
}

function joinLines(lines: ReadonlyArray<string | null>): string {
  return lines.filter((line): line is string => Boolean(line)).join("\n");
}

/** 欄と行、入力済みの値から、モデルへ渡す短い文脈を組み立てる。 */
export function buildVoicePrompt(input: VoicePromptInput): string {
  const requested = input.row ?? 0;
  const row = Number.isInteger(requested) && requested >= 0 ? requested : 0;
  const field = input.field ? voiceFieldByKey(input.field) : null;
  const label = field ? voiceFieldLabel(field.key, row) : null;

  const head = label
    ? `イベント作成フォームの「${label}」を話しています。`
    : "イベント作成フォームの入力を話しています。";
  const clues = clueLine(cleanClue(input.title), cleanClue(input.venueName));

  const lines: Array<string | null> = [head, clues];
  let prompt = joinLines(lines);
  // 後ろの手掛かりから落とす。1 行目（どの欄か）は必ず残す。
  if (prompt.length > VOICE_PROMPT_MAX && clues) {
    lines[1] = null;
    prompt = joinLines(lines);
  }
  return prompt.length > VOICE_PROMPT_MAX ? prompt.slice(0, VOICE_PROMPT_MAX) : prompt;
}

/**
 * 欄の語彙と入力済みの当て字から、モデルへ渡す `keywords` を組み立てる。
 *
 * 入力済みの催し名・会場名は先に置く（20 語の上限で落とさないため）。
 * いま聞いている欄の現在値は入れない（言い直しの邪魔になるため）。
 */
export function buildVoiceKeywords(
  field: VoiceField | null,
  input: VoiceKeywordInput = {},
): string[] {
  const words: string[] = [];
  const seen = new Set<string>();

  const add = (raw: string | null | undefined): void => {
    if (typeof raw !== "string") return;
    const word = cleanKeyword(raw);
    if (!word || seen.has(word)) return;
    seen.add(word);
    words.push(word);
  };

  if (field?.key !== "title") add(input.title);
  if (field?.key !== "venueName") add(input.venueName);
  for (const keyword of field?.keywords ?? []) add(keyword);

  return words.slice(0, VOICE_KEYWORDS_MAX);
}
