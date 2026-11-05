import {
  groupPricePlanPairs,
  RAIN_POLICY_LABELS,
  type EventFormValues,
} from "@/modules/events/types";
import { isSlotNeeded, voiceFieldOrder } from "@/modules/events/lib/voice/fields";
import { isVoiceMockEnabled } from "@/modules/events/lib/voice/mock";
import {
  assignUtterance,
  type UtteranceAssignment,
} from "@/modules/events/lib/voice/utterance";
import type {
  VoiceFieldScope,
  VoicePatch,
  VoiceSlot,
  VoiceSlotId,
} from "@/modules/events/lib/voice/types";

/**
 * 「まとめて話す」モードのサーバー側。
 *
 * 文字起こしは 1 回だけ。まず `assignUtterance` で決定的に割り当て、
 * どこにも当たらなかった節だけを LLM に「どの欄の話か」として尋ねる。
 * LLM には値を書かせず、返ってきた節を必ずその欄の `parse` に通す。
 * これで、認識の揺れがあっても値の作り方は 1 か所（`parse.ts`）に閉じる。
 */

/** 割当の推定に使う既定のモデル。`VOICE_BATCH_MODEL` で差し替えられる。 */
export const DEFAULT_VOICE_BATCH_MODEL = "gpt-4.1-mini";

const OPENAI_CHAT_URL = "https://api.openai.com/v1/chat/completions";

/** 割当の推定は補助なので、待ちすぎない。 */
const BATCH_TIMEOUT_MS = 15_000;

/** LLM に返させる形。値は持たせず、`slotId` と `clause` だけにする。 */
const BATCH_RESPONSE_SCHEMA = {
  type: "json_schema",
  json_schema: {
    name: "voice_batch_assignments",
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
              clause: { type: "string" },
            },
            required: ["slotId", "clause"],
            additionalProperties: false,
          },
        },
      },
      required: ["assignments"],
      additionalProperties: false,
    },
  },
} as const;

/** 推定の指示。値の生成・言い換え・補完を禁じる。 */
const BATCH_SYSTEM_PROMPT = [
  "あなたは音声入力の割り当て器です。",
  "与えられた節（clauses）を、候補の欄（slots）へ割り当ててください。",
  "値の作成・変換・補完・言い換えは禁止です。clause は与えられた文字列をそのまま返してください。",
  "候補に無い slotId は返さないでください。",
  "どの欄にも当たらない節は返さないでください。",
  "1 つの節は 1 つの欄だけに、1 つの欄は 1 つの節だけに割り当ててください。",
  '出力は {"assignments":[{"slotId":"...","clause":"..."}]} だけです。',
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
  /** LLM の推定を重ねたか。0 件でも「呼んだが当たらなかった」を含む。 */
  estimated: boolean;
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
  });
}

/**
 * モックの文字起こし。巡回する欄の入力例を `、` でつないだ 1 文を返す。
 * 画面と API が同じ文を使えるよう、例は `fields.ts` の `example` だけから作る。
 */
export function mockBatchTranscript(
  value: EventFormValues,
  scope: VoiceFieldScope,
): string {
  const seen = new Set<string>();
  const examples: string[] = [];
  for (const slot of voiceFieldOrder(value, scope)) {
    if (!isSlotNeeded(slot, value, scope)) continue;
    const example = slot.field.example;
    if (seen.has(example)) continue;
    seen.add(example);
    examples.push(example);
  }
  return examples.join("、");
}

/**
 * 未割当の節を、候補の欄へ割り当てる。返すのは割当だけ。
 *
 * 受け取った `clause` は必ず候補の欄の `parse` に通し、null のときは捨てる。
 * 未割当でない節・存在しない `slotId`・重複した割当も捨てる。
 */
export async function estimateBatchAssignments(
  slots: readonly VoiceSlot[],
  clauses: readonly string[],
  value: EventFormValues,
  now: Date,
  scope: VoiceFieldScope,
): Promise<UtteranceAssignment[]> {
  if (slots.length === 0 || clauses.length === 0) return [];
  if (!isVoiceBatchLlmEnabled()) return [];
  // モックは外部を呼ばない。API キーの有無より先に見る。
  if (isVoiceMockEnabled()) return [];

  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) return [];

  // 渡された候補のうち、いまのスコープでも巡回するものだけを使う。
  const ordered = voiceFieldOrder(value, scope);
  const allowed = new Set(slots.map((slot) => slot.id));
  const candidates = ordered.filter((slot) => allowed.has(slot.id));
  if (candidates.length === 0) return [];

  const payload = {
    slots: candidates.map((slot) => ({ slotId: slot.id, label: slot.label })),
    clauses: [...clauses],
  };

  const model = voiceBatchModel();
  let response: Response;
  try {
    response = await postBatch(apiKey, model, payload, "json_schema");
  } catch {
    console.warn("[voice] batch assignment failed: status=network code=fetch_failed");
    return [];
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
      return [];
    }
  }

  if (!response.ok) {
    console.warn(
      `[voice] batch assignment failed: status=${response.status} code=${await readErrorCode(response)}`,
    );
    return [];
  }

  const content = await readContent(response);
  if (content === null) return [];

  return readAssignments(content, candidates, clauses, value, now);
}

/** 1 回の発話を、決定的な割当と LLM の推定で 1 つの結果にまとめる。 */
export async function assignBatch(
  text: string,
  context: BatchRequestContext,
): Promise<BatchResult> {
  const deterministic = assignDeterministically(text, context);
  const usedSlots = new Set(deterministic.assignments.map((item) => item.slotId));
  const clauses = deterministic.unassigned;

  const available = voiceFieldOrder(context.value, context.scope).filter(
    (slot) => !usedSlots.has(slot.id),
  );
  const estimated =
    clauses.length > 0 && available.length > 0
      ? await estimateBatchAssignments(
          available,
          clauses,
          context.value,
          context.now,
          context.scope,
        )
      : [];

  const slots = new Map(
    voiceFieldOrder(context.value, context.scope).map((slot) => [slot.id, slot]),
  );
  const assignments = [...deterministic.assignments, ...estimated].map((item) => {
    const slot = slots.get(item.slotId);
    return {
      ...item,
      value: slot ? readableValue(slot, item.patch) : null,
    };
  });

  const claimed = new Set(estimated.map((item) => item.text));
  return {
    assignments,
    unassigned: clauses.filter((clause) => !claimed.has(clause)),
    estimated: estimated.length > 0,
  };
}

async function postBatch(
  apiKey: string,
  model: string,
  payload: { slots: { slotId: string; label: string }[]; clauses: string[] },
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

/**
 * 返ってきた割当を検証する。LLM の出力はそのまま信じない。
 *
 * - 未割当の節にしか当てない
 * - 存在する `slotId` にしか当てない
 * - 値は `field.parse` が読めたときだけ採用する
 * - 同じ節・同じ欄を 2 回使わない
 */
function readAssignments(
  payload: unknown,
  slots: readonly VoiceSlot[],
  clauses: readonly string[],
  value: EventFormValues,
  now: Date,
): UtteranceAssignment[] {
  if (!isRecord(payload) || !Array.isArray(payload.assignments)) return [];

  const offered = new Map<string, VoiceSlot>(slots.map((slot) => [slot.id, slot]));
  const allowedClauses = new Set(clauses);
  const usedSlots = new Set<VoiceSlotId>();
  const usedClauses = new Set<string>();
  const assignments: UtteranceAssignment[] = [];

  for (const item of payload.assignments) {
    if (!isRecord(item)) continue;
    const slotId = typeof item.slotId === "string" ? item.slotId : null;
    const rawClause = typeof item.clause === "string" ? item.clause.trim() : null;
    if (!slotId || !rawClause) continue;

    const slot = offered.get(slotId);
    if (!slot) continue;
    if (!allowedClauses.has(rawClause)) continue;
    if (usedSlots.has(slot.id) || usedClauses.has(rawClause)) continue;

    const patch = slot.field.parse(rawClause, { now, value, row: slot.row });
    if (patch === null) continue;

    usedSlots.add(slot.id);
    usedClauses.add(rawClause);
    assignments.push({ slotId: slot.id, text: rawClause, patch });
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
