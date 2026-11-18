import {
  groupPricePlanPairs,
  RAIN_POLICY_LABELS,
  type EventFormValues,
} from "@/modules/events/types";
import { batchTargets } from "@/modules/events/lib/voice/batch-guide";
import { isVoiceMockEnabled } from "@/modules/events/lib/voice/mock";
import {
  assignUtterance,
  type UtteranceAssignment,
} from "@/modules/events/lib/voice/utterance";
import type {
  VoiceBatchDiagnostics,
  VoiceBatchLlmReason,
  VoiceFieldKey,
  VoiceFieldScope,
  VoicePatch,
  VoiceSlot,
  VoiceSlotId,
} from "@/modules/events/lib/voice/types";

/**
 * 「自由に話す」モードのサーバー側。
 *
 * 文字起こしは 1 回だけ。まず LLM に、話した文章から欄ごとの値（原文の部分文字列）を
 * 抜き出させる。そのあと `assignUtterance` で、まだ埋まっていない欄を決定的に補う。
 * LLM には値を書かせず、返ってきた quote を必ずその欄の `parse` に通す。
 * これで、認識の揺れがあっても値の作り方は 1 か所（`parse.ts`）に閉じる。
 */

/** 割当の推定に使う既定のモデル。`VOICE_BATCH_MODEL` で差し替えられる。 */
export const DEFAULT_VOICE_BATCH_MODEL = "gpt-4.1-mini";

const OPENAI_CHAT_URL = "https://api.openai.com/v1/chat/completions";

/** 割当の推定は補助なので、待ちすぎない。 */
const BATCH_TIMEOUT_MS = 15_000;

/** LLM に返させる形。値は持たせず、`slotId` と原文の `quote` だけにする。 */
const BATCH_RESPONSE_SCHEMA = {
  type: "json_schema",
  json_schema: {
    name: "voice_batch_quotes",
    strict: true,
    schema: {
      type: "object",
      properties: {
        assignments: {
          type: "array",
          items: {
            type: "object",
            properties: {
              slotId: { type: "string" },
              quote: { type: "string" },
            },
            required: ["slotId", "quote"],
            additionalProperties: false,
          },
        },
      },
      required: ["assignments"],
      additionalProperties: false,
    },
  },
} as const;

/** 抽出の指示。値の生成・言い換え・補完を禁じ、原文の部分文字列だけを返させる。 */
const BATCH_SYSTEM_PROMPT = [
  "あなたは音声入力の値の抽出器です。",
  "入力の article（話した文章）から、候補の欄（slots）それぞれに入る値だけを、原文のまま抜き出してください。",
  "日付の欄には日付だけ、時刻の欄には時刻だけ、金額の欄には金額だけを抜き出してください。",
  "quote は article にそのまま存在する部分文字列にしてください。前後の助詞や句読点は含めないでください。",
  "値の作成・変換・計算・補完・言い換えは禁止です。",
  "候補に無い slotId は返さないでください。",
  "1 つの欄は 1 つの quote だけにし、同じ quote を 2 つの欄に使わないでください。",
  "どの欄にも当たらないときは、その欄を返さないでください。",
  '出力は {"assignments":[{"slotId":"...","quote":"..."}]} だけです。',
].join("\n");

export interface BatchRequestContext {
  now: Date;
  value: EventFormValues;
  scope: VoiceFieldScope;
}

/** 確認画面に出す 1 行。`value` は「人間が読める確定値」、`patch` はフォームへ当てる差分。 */
export interface BatchAssignment extends UtteranceAssignment {
  value: string | number | null;
}

export interface BatchResult {
  assignments: BatchAssignment[];
  unassigned: string[];
  /** LLM の quote 抽出で 1 件以上埋まったか。 */
  estimated: boolean;
  /** LLM と決定的な割当の内訳。不具合の切り分けにだけ使う。 */
  diagnostics: VoiceBatchDiagnostics;
}

/** LLM の quote 抽出だけを取り出した結果。内訳を捨てずに呼び出し側へ渡す。 */
export interface BatchEstimate {
  assignments: UtteranceAssignment[];
  diagnostics: VoiceBatchDiagnostics;
}

export function voiceBatchModel(): string {
  const configured = process.env.VOICE_BATCH_MODEL?.trim();
  return configured ? configured : DEFAULT_VOICE_BATCH_MODEL;
}

/** `VOICE_BATCH_LLM=0` のときだけ切る。未設定は有効。 */
export function isVoiceBatchLlmEnabled(): boolean {
  return process.env.VOICE_BATCH_LLM?.trim() !== "0";
}

/**
 * 決定的な割当。実装は `assignUtterance` に任せ、ここでは引数の形だけを整える。
 *
 * 対象は空欄だけ（`batchTargets`）。入力済みの欄を静かに上書きしないため、
 * 巡回順のすべてではなく、いま埋めるべきマスだけを渡す。
 * 自然な文を丸ごと渡す経路なので、自由文の欄には文全体を渡さないガードを有効にする。
 */
export function assignDeterministically(
  text: string,
  context: BatchRequestContext,
): { assignments: UtteranceAssignment[]; unassigned: string[] } {
  return assignUtterance({
    text,
    value: context.value,
    now: context.now,
    scope: context.scope,
    targets: batchTargets(context.value, context.scope),
    freeTextGuard: true,
  });
}

/**
 * モックの文字起こし。巡回する欄の入力例から、自然な文を組み立てる。
 *
 * 例は `fields.ts` の `example` だけから作り、`、` 区切りの列挙にはしない。
 * 「忘年会。12月5日に開きます。18時から20時、渋谷ホールで行います。…」のように、
 * 話し言葉としてそのまま読める形にする。入力済みの欄の例は含めない。
 */
export function mockBatchTranscript(
  value: EventFormValues,
  scope: VoiceFieldScope,
): string {
  const targets = batchTargets(value, scope);
  const example = (key: VoiceFieldKey): string | null => {
    const slot = targets.find((item) => item.key === key);
    return slot ? slot.field.example : null;
  };

  const sentences: string[] = [];

  // 何を（題だけを 1 文にする。文全体を題にしないための区切りでもある）。
  const title = example("title");
  if (title) sentences.push(`${title}。`);

  // いつ・何時から・どこで。日付と時刻を別の文にして、1 節に混ぜない。
  const date = example("scheduleDate");
  if (date) sentences.push(`${date}に開きます。`);

  const start = example("scheduleStart");
  const end = example("scheduleEnd");
  const venue = example("venueName");
  const time = start && end ? `${start}から${end}` : (start ?? (end ? `${end}まで` : null));
  if (time && venue) sentences.push(`${time}、${venue}で行います。`);
  else if (time) sentences.push(`${time}に始めます。`);
  else if (venue) sentences.push(`${venue}で行います。`);

  // 料金。
  const planName = example("planName");
  const amount = example("planAmount");
  const note = example("planNote");
  const price: string[] = [];
  if (amount) price.push(`参加費は${amount}`);
  else if (planName) price.push(`料金は${planName}`);
  if (note) price.push(note);
  if (price.length > 0) sentences.push(`${price.join("、")}です。`);

  // 場所。
  const postalCode = example("postalCode");
  const address = [
    example("prefecture"),
    example("city"),
    example("town"),
    example("addressLine"),
  ]
    .filter((part): part is string => part !== null)
    .join("");
  const building = example("building");
  const place: string[] = [];
  if (postalCode) place.push(`郵便番号は${postalCode}`);
  if (address) place.push(`住所は${address}`);
  if (building) place.push(building);
  if (place.length > 0) sentences.push(`${place.join("、")}です。`);

  // 定員と期限。
  const capacity = example("capacity");
  const deadline = example("rsvpDeadline");
  const rainPolicy = example("rainPolicy");
  const closing: string[] = [];
  if (capacity) closing.push(`定員は${capacity}`);
  if (deadline) closing.push(`申し込み期限は${deadline}`);
  if (rainPolicy) closing.push(rainPolicy);
  if (closing.length > 0) sentences.push(`${closing.join("、")}です。`);

  return sentences.join("");
}

/**
 * 話した文章から、候補の欄に入る値（原文の部分文字列）を LLM に抜き出させる。
 * 返すのは割当だけ。値は作らせない。
 *
 * 受け取った `quote` は前後の助詞・句読点を落として原文に存在することを確かめ、
 * さらに必ず候補の欄の `parse` に通す。null のときは捨てる。
 * 存在しない `slotId`・原文に無い quote・重複した割当も捨てる。
 */
export async function estimateBatchAssignments(
  slots: readonly VoiceSlot[],
  text: string,
  value: EventFormValues,
  now: Date,
  scope: VoiceFieldScope,
): Promise<BatchEstimate> {
  const article = text.trim();
  const chars = article.length;
  // 呼ばなかった理由も残す。無言で `[]` を返すと、モデルのせいか配線のせいか分からない。
  const blank = (reason: VoiceBatchLlmReason): BatchEstimate => ({
    assignments: [],
    diagnostics: diagnosticsOf(reason, chars),
  });

  if (slots.length === 0 || chars === 0) return blank("no-input");
  if (!isVoiceBatchLlmEnabled()) return blank("skipped");
  // モックは外部を呼ばない。API キーの有無より先に見る。
  if (isVoiceMockEnabled()) return blank("mock");

  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) return blank("no-key");

  // 渡された候補のうち、いま埋めるべきマス（空欄）だけを使う。
  // 呼び出し側が巡回順のすべてを渡しても、入力済みの欄へは当てない。
  const ordered = batchTargets(value, scope);
  const allowed = new Set(slots.map((slot) => slot.id));
  const candidates = ordered.filter((slot) => allowed.has(slot.id));
  if (candidates.length === 0) return blank("no-candidates");

  const payload = {
    article,
    slots: candidates.map((slot) => ({ slotId: slot.id, label: slot.label })),
  };

  const model = voiceBatchModel();
  let response: Response;
  try {
    response = await postBatch(apiKey, model, payload, "json_schema");
  } catch {
    console.warn("[voice] batch assignment failed: status=network code=fetch_failed");
    return blank("network");
  }

  if (response.status === 400) {
    // `json_schema` を知らないモデルは 400 を返す。`json_object` で 1 度だけ試す。
    console.warn(
      `[voice] batch assignment failed: status=400 code=${await readErrorCode(response)}`,
    );
    try {
      response = await postBatch(apiKey, model, payload, "json_object");
    } catch {
      console.warn("[voice] batch assignment failed: status=network code=fetch_failed");
      return blank("network");
    }
  }

  if (!response.ok) {
    console.warn(
      `[voice] batch assignment failed: status=${response.status} code=${await readErrorCode(response)}`,
    );
    return blank("http-error");
  }

  const content = await readContent(response);
  if (content === null) return blank("no-content");

  const assignments = readAssignments(content, candidates, article, value, now);
  const quotes = countQuotes(content);
  return {
    assignments,
    diagnostics: diagnosticsOf(assignments.length > 0 ? "ok" : "empty", chars, {
      quotes,
      accepted: assignments.length,
    }),
  };
}

/**
 * 内訳の雛形。`dropped` はここで引き算にして、数え漏れを作らない。
 * `deterministic` は決定的な割当のあとで `assignBatch` が入れる。
 */
function diagnosticsOf(
  reason: VoiceBatchLlmReason,
  chars: number,
  counts: { quotes?: number; accepted?: number; deterministic?: number } = {},
): VoiceBatchDiagnostics {
  const quotes = counts.quotes ?? 0;
  const accepted = counts.accepted ?? 0;
  return {
    reason,
    quotes,
    accepted,
    dropped: Math.max(0, quotes - accepted),
    deterministic: counts.deterministic ?? 0,
    chars,
  };
}

/** モデルが返した割当の数。形の崩れた行も 1 件として数える（捨てた数に出る）。 */
function countQuotes(payload: unknown): number {
  if (!isRecord(payload) || !Array.isArray(payload.assignments)) return 0;
  return payload.assignments.length;
}

/**
 * 内訳を 1 行だけ出す。本文と quote は出さない。
 *
 * 「モデルが返さなかった」のか「返したが検証で落ちた」のかを、録音 1 回ごとに
 * サーバーのログだけで切り分けられるようにする。テストの出力は汚さない。
 */
function logDiagnostics(diagnostics: VoiceBatchDiagnostics): void {
  if (process.env.NODE_ENV === "test") return;
  console.info(
    `[voice] batch llm=${diagnostics.reason} quotes=${diagnostics.quotes}` +
      ` accepted=${diagnostics.accepted} dropped=${diagnostics.dropped}` +
      ` deterministic=${diagnostics.deterministic} chars=${diagnostics.chars}`,
  );
}

/**
 * 1 回の発話を、LLM の quote 抽出と決定的な割当で 1 つの結果にまとめる。
 *
 * 1. LLM に原文から欄ごとの quote を抜き出させる（値は作らせない）
 * 2. まだ埋まっていない欄を `assignUtterance` で決定的に補う
 * 3. `batchTargets` の順に並べ、確認ダイアログの行順を安定させる
 */
export async function assignBatch(
  text: string,
  context: BatchRequestContext,
): Promise<BatchResult> {
  // 空欄だけを対象にする。LLM の推定も決定的な割当も同じ並びから作る。
  const targets = batchTargets(context.value, context.scope);
  const estimate = await estimateBatchAssignments(
    targets,
    text,
    context.value,
    context.now,
    context.scope,
  );
  const estimated = estimate.assignments;

  const usedSlots = new Set(estimated.map((item) => item.slotId));
  const available = targets.filter((slot) => !usedSlots.has(slot.id));

  // LLM が抜き出した quote は、決定的な割当で二度使わない。
  // 同じ数字を別の欄（金額と定員）へ取り違えないよう、原文から取り除いてから渡す。
  const remaining = maskQuotes(text, estimated.map((item) => item.text));
  const deterministic =
    available.length > 0
      ? assignUtterance({
          text: remaining,
          value: context.value,
          now: context.now,
          scope: context.scope,
          targets: available,
          freeTextGuard: true,
        })
      : { assignments: [], unassigned: [] };

  const slots = new Map<VoiceSlotId, VoiceSlot>(
    targets.map((slot) => [slot.id, slot]),
  );
  const order = new Map<VoiceSlotId, number>(
    targets.map((slot, index) => [slot.id, index]),
  );
  const assignments = [...estimated, ...deterministic.assignments]
    .sort((left, right) => (order.get(left.slotId) ?? 0) - (order.get(right.slotId) ?? 0))
    .map((item) => {
      const slot = slots.get(item.slotId);
      return {
        ...item,
        value: slot ? readableValue(slot, item.patch) : null,
      };
    });

  const diagnostics = diagnosticsOf(estimate.diagnostics.reason, estimate.diagnostics.chars, {
    quotes: estimate.diagnostics.quotes,
    accepted: estimate.diagnostics.accepted,
    deterministic: deterministic.assignments.length,
  });
  logDiagnostics(diagnostics);

  return {
    assignments,
    unassigned: deterministic.unassigned,
    estimated: estimated.length > 0,
    diagnostics,
  };
}

/**
 * LLM が抜き出した quote を、原文から区切りへ置き換える。
 *
 * 決定的な割当は節を丸ごと読むため、同じ文字列を別の欄に使い回しうる。
 * quote を消しておけば、残りの欄は LLM が触れなかった部分だけから補える。
 */
function maskQuotes(text: string, quotes: readonly string[]): string {
  let remaining = text;
  for (const quote of quotes) {
    if (!quote) continue;
    const at = remaining.indexOf(quote);
    if (at < 0) continue;
    remaining = `${remaining.slice(0, at)}、${remaining.slice(at + quote.length)}`;
  }
  return remaining;
}

async function postBatch(
  apiKey: string,
  model: string,
  payload: { article: string; slots: { slotId: string; label: string }[] },
  format: "json_schema" | "json_object",
): Promise<Response> {
  return fetch(OPENAI_CHAT_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      temperature: 0,
      messages: [
        { role: "system", content: BATCH_SYSTEM_PROMPT },
        { role: "user", content: JSON.stringify(payload) },
      ],
      response_format:
        format === "json_schema" ? BATCH_RESPONSE_SCHEMA : { type: "json_object" },
    }),
    signal: AbortSignal.timeout(BATCH_TIMEOUT_MS),
  });
}

/** 上流の本文は利用者にもログにも出さない。調査に要る `code` だけを読む。 */
async function readErrorCode(response: Response): Promise<string> {
  const body = (await response.json().catch(() => null)) as {
    error?: { code?: unknown };
  } | null;
  const code = body?.error?.code;
  return typeof code === "string" && code ? code : "unknown";
}

async function readContent(response: Response): Promise<unknown> {
  const body = (await response.json().catch(() => null)) as {
    choices?: { message?: { content?: unknown } }[];
  } | null;
  const content = body?.choices?.[0]?.message?.content;
  if (typeof content !== "string" || !content.trim()) return null;

  // `json_object` へ落としたときも、そのまま JSON だけを返す想定。念のため囲みを外す。
  const trimmed = content.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/u.exec(trimmed);
  try {
    return JSON.parse(fenced ? fenced[1] : trimmed);
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** quote の前後から落とす句読点・記号・空白。 */
const QUOTE_EDGE =
  /^[\s、。，,．.!！?？「」『』（）()【】…‥・:：;；~〜ー-]+|[\s、。，,．.!！?？「」『』（）()【】…‥・:：;；~〜ー-]+$/gu;

/**
 * quote の前後から落とす助詞。長いものから見て、短い助詞が長い助詞を壊さないようにする。
 * 末尾の「に」「で」は「12月5日に」「渋谷ホールで」を値だけにするために落とす。
 */
const QUOTE_PARTICLES: readonly string[] = [
  "から",
  "まで",
  "より",
  "には",
  "では",
  "にも",
  "とも",
  "など",
  "を",
  "は",
  "が",
  "に",
  "で",
  "と",
  "や",
  "へ",
  "の",
  "も",
];

/** 先頭の助詞を 1 つ落とす。無ければそのまま返す。 */
function stripLeadingParticle(text: string): string {
  for (const particle of QUOTE_PARTICLES) {
    if (text.startsWith(particle)) return text.slice(particle.length).trim();
  }
  return text;
}

/** 末尾の助詞を 1 つ落とす。無ければそのまま返す。 */
function stripTrailingParticle(text: string): string {
  for (const particle of QUOTE_PARTICLES) {
    if (text.endsWith(particle)) return text.slice(0, -particle.length).trim();
  }
  return text;
}

/**
 * quote を値だけに寄せる。前後の句読点・空白・助詞を落とし、
 * 落とした結果が空になったら空文字（＝捨てる）を返す。
 */
function trimQuote(raw: string): string {
  let quote = raw.trim();
  for (let pass = 0; pass < 3; pass += 1) {
    const before = quote;
    quote = quote.replace(QUOTE_EDGE, "").trim();
    quote = stripLeadingParticle(quote);
    quote = stripTrailingParticle(quote);
    if (quote === before) break;
  }
  return quote.trim();
}

/**
 * 返ってきた割当を検証する。LLM の出力はそのまま信じない。
 *
 * - 存在する `slotId` にしか当てない
 * - quote は前後の助詞・句読点を落としてから、原文に存在するときだけ採用する
 * - 値は `field.parse` が読めたときだけ採用する
 * - 同じ quote・同じ欄を 2 回使わない
 */
function readAssignments(
  payload: unknown,
  slots: readonly VoiceSlot[],
  article: string,
  value: EventFormValues,
  now: Date,
): UtteranceAssignment[] {
  if (!isRecord(payload) || !Array.isArray(payload.assignments)) return [];

  const offered = new Map<string, VoiceSlot>(slots.map((slot) => [slot.id, slot]));
  const usedSlots = new Set<VoiceSlotId>();
  const usedQuotes = new Set<string>();
  const assignments: UtteranceAssignment[] = [];

  for (const item of payload.assignments) {
    if (!isRecord(item)) continue;
    const slotId = typeof item.slotId === "string" ? item.slotId : null;
    const rawQuote = typeof item.quote === "string" ? item.quote : null;
    if (!slotId || rawQuote === null) continue;

    const slot = offered.get(slotId);
    if (!slot) continue;
    if (usedSlots.has(slot.id)) continue;

    const quote = trimQuote(rawQuote);
    if (!quote || !article.includes(quote)) continue;
    if (usedQuotes.has(quote)) continue;

    const patch = slot.field.parse(quote, { now, value, row: slot.row });
    if (patch === null) continue;

    usedSlots.add(slot.id);
    usedQuotes.add(quote);
    // 範囲で読めた開始時刻は、同じ行の終了時刻も埋めている。終了を二重に割り当てない。
    if (slot.key === "scheduleStart") {
      const row = patch.schedules?.[slot.row];
      if (row?.startTime && row.endTime) {
        usedSlots.add(`scheduleEnd:${slot.row}` as VoiceSlotId);
      }
    }
    assignments.push({ slotId: slot.id, text: quote, patch });
  }

  return assignments;
}

/**
 * 確認画面に出す確定値。パッチから直接読む。
 *
 * 複数のパッチを順に当てると、同じ配列（`schedules` / `pricePlans`）を丸ごと持つ
 * パッチ同士が上書きし合うため、`value` はパッチ単体から作る。
 */
function readableValue(slot: VoiceSlot, patch: VoicePatch): string | number | null {
  switch (slot.key) {
    case "title":
      return patch.title || null;
    case "organizerName":
      return patch.organizerDisplayName || null;
    case "scheduleDate":
      return patch.schedules?.[slot.row]?.eventDate || null;
    case "scheduleStart":
      return patch.schedules?.[slot.row]?.startTime || null;
    case "scheduleEnd":
      return patch.schedules?.[slot.row]?.endTime || null;
    case "planName": {
      const group = patch.pricePlans
        ? groupPricePlanPairs(patch.pricePlans)[slot.row]
        : undefined;
      return group?.[0]?.name || null;
    }
    case "planAmount": {
      const raw = patch.pricePlans?.[slot.row]?.amount;
      if (!raw) return null;
      const amount = Number(raw);
      return Number.isFinite(amount) ? amount : null;
    }
    case "planNote":
      return patch.pricePlans?.[slot.row]?.note || null;
    case "venueName":
      return patch.venueName || null;
    case "postalCode":
      return patch.postalCode || null;
    case "prefecture":
      return patch.prefecture || null;
    case "city":
      return patch.city || null;
    case "town":
      return patch.town || null;
    case "addressLine":
      return patch.addressLine || null;
    case "building":
      return patch.building || null;
    case "rainPolicy":
      return patch.rainPolicy ? RAIN_POLICY_LABELS[patch.rainPolicy] : null;
    case "capacity":
      // null は「無制限」。値が無いのではなく、制限なしが確定している。
      return patch.capacity ?? null;
    case "rsvpDeadline":
      return patch.rsvpDeadline ?? null;
    default:
      return null;
  }
}
