import { NextRequest } from "next/server";
import { z } from "zod";
import { ProblemDetailException } from "@/lib/exceptions";
import { toErrorResponse } from "@/lib/http";
import { clientIp } from "@/modules/auth/lib/cookies";
import { MAX_AUDIO_BYTES } from "@/modules/events/lib/voice/audio";
import {
  assignBatch,
  mockBatchTranscript,
} from "@/modules/events/lib/voice/batch";
import { VOICE_FIELD_KEYS } from "@/modules/events/lib/voice/fields";
import {
  isVoiceMockEnabled,
  warnVoiceConfigurationOnce,
} from "@/modules/events/lib/voice/mock";
import { transcribeDetailed } from "@/modules/events/lib/voice/openai";
import { consumeVoiceRateLimit } from "@/modules/events/lib/voice/rate-limit";
import type {
  VoiceFieldKey,
  VoiceFieldScope,
} from "@/modules/events/lib/voice/types";
import {
  EMPTY_EVENT_FORM,
  MAX_EVENT_OPTIONS,
  type EventFormValues,
} from "@/modules/events/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const INSTANCE = "/api/v1/voice/utterances";

/** `text` で受け取れる長さ。区間の文字起こしをまとめた全文を想定する。 */
const MAX_TEXT_LENGTH = 2000;

// 既存の音声ルートと同じく、設定を 1 度だけ知らせる。テストでは出さない。
if (process.env.NODE_ENV !== "test") warnVoiceConfigurationOnce();

const scheduleDraftSchema = z.object({
  key: z.string().min(1),
  id: z.string().optional(),
  eventDate: z.string(),
  startTime: z.string(),
  endTime: z.string(),
});

const pricePlanDraftSchema = z.object({
  key: z.string().min(1),
  id: z.string().optional(),
  name: z.string(),
  audience: z.enum(["ANY", "MALE", "FEMALE"]),
  amount: z.string(),
  note: z.string(),
});

/**
 * フォームの現在値。音声の `parse` が読む欄だけを検証し、余分な欄は捨てる。
 * `schedules` と `pricePlans` は行の形が崩れると割当が成り立たないため必須にする。
 */
const eventFormValueSchema = z.object({
  title: z.string().default(""),
  schedules: z.array(scheduleDraftSchema).min(1).max(MAX_EVENT_OPTIONS),
  pricePlans: z.array(pricePlanDraftSchema).min(1).max(MAX_EVENT_OPTIONS),
  organizerDisplayName: z.string().default(""),
  location: z.string().default(""),
  postalCode: z.string().default(""),
  prefecture: z.string().default(""),
  city: z.string().default(""),
  town: z.string().default(""),
  addressLine: z.string().default(""),
  building: z.string().default(""),
  venueName: z.string().default(""),
  rainPolicy: z
    .enum(["RAIN_OR_SHINE", "CANCEL_ON_RAIN", "POSTPONE_ON_RAIN", "INDOOR"])
    .default("RAIN_OR_SHINE"),
  capacity: z.number().int().nonnegative().nullable().default(null),
  targetGeneration: z.string().default(""),
  themeId: z.string().nullable().default(null),
  flyerAssetId: z.string().nullable().default(null),
  rsvpDeadline: z.string().default(""),
  status: z.enum(["DRAFT", "PUBLISHED", "CLOSED"]).optional(),
});

const scopeSchema = z.object({
  showOrganizerName: z.boolean().optional(),
  includeOptional: z.boolean().optional(),
  touched: z.array(z.string()).optional(),
});

const DEFAULT_SCOPE: VoiceFieldScope = {
  showOrganizerName: false,
  includeOptional: true,
  touched: new Set(),
};

function isVoiceFieldKey(value: string): value is VoiceFieldKey {
  return (VOICE_FIELD_KEYS as readonly string[]).includes(value);
}

/** 音声の形式から拡張子を決める。OpenAI は拡張子で形式を見る。 */
function filenameFor(contentType: string): string {
  if (contentType.includes("mp4")) return "voice.m4a";
  if (contentType.includes("ogg")) return "voice.ogg";
  if (contentType.includes("wav")) return "voice.wav";
  if (contentType.includes("mpeg")) return "voice.mp3";
  return "voice.webm";
}

/** `value` の JSON 文字列を、`parse` が安全に読めるフォームの値へ直す。 */
function parseFormValue(raw: FormDataEntryValue | null): EventFormValues | null {
  if (typeof raw !== "string") return null;
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return null;
  }
  const parsed = eventFormValueSchema.safeParse(json);
  if (!parsed.success) return null;

  return {
    ...EMPTY_EVENT_FORM,
    title: parsed.data.title,
    schedules: parsed.data.schedules,
    pricePlans: parsed.data.pricePlans,
    // 割引は音声の対象にしない。パッチにも含まれない。
    discounts: [],
    organizerDisplayName: parsed.data.organizerDisplayName,
    location: parsed.data.location,
    postalCode: parsed.data.postalCode,
    prefecture: parsed.data.prefecture,
    city: parsed.data.city,
    town: parsed.data.town,
    addressLine: parsed.data.addressLine,
    building: parsed.data.building,
    venueName: parsed.data.venueName,
    rainPolicy: parsed.data.rainPolicy,
    capacity: parsed.data.capacity,
    targetGeneration: parsed.data.targetGeneration,
    themeId: parsed.data.themeId as EventFormValues["themeId"],
    flyerAssetId: parsed.data.flyerAssetId,
    rsvpDeadline: parsed.data.rsvpDeadline,
    ...(parsed.data.status ? { status: parsed.data.status } : {}),
  };
}

/** 巡回の指定。読めない値は既定（任意欄も聞く・主催者名は聞かない）にする。 */
function parseScope(raw: FormDataEntryValue | null): VoiceFieldScope {
  if (typeof raw !== "string") return DEFAULT_SCOPE;
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return DEFAULT_SCOPE;
  }
  const parsed = scopeSchema.safeParse(json);
  if (!parsed.success) return DEFAULT_SCOPE;

  const touched = new Set<VoiceFieldKey>(
    (parsed.data.touched ?? []).filter(isVoiceFieldKey),
  );
  return {
    showOrganizerName: parsed.data.showOrganizerName ?? DEFAULT_SCOPE.showOrganizerName,
    includeOptional: parsed.data.includeOptional ?? DEFAULT_SCOPE.includeOptional,
    touched,
  };
}

/**
 * 任意の `text`（区間の文字起こしをまとめた全文）を取り出す。
 * `text` が無い・空文字なら null（音声から文字起こしする従来の経路へ落とす）。
 */
function parseProvidedText(raw: FormDataEntryValue | null): string | null {
  if (typeof raw !== "string") return null;
  if (raw.length > MAX_TEXT_LENGTH) {
    throw new ProblemDetailException({
      status: 400,
      title: "Validation Error",
      detail: `話した内容が長すぎます。${MAX_TEXT_LENGTH} 文字までにしてください。`,
    });
  }
  const text = raw.trim();
  return text.length > 0 ? text : null;
}

/**
 * 1 回の発話から、複数の欄をまとめて埋める。
 *
 * 文字起こしは 1 回だけ。まず LLM に原文から欄ごとの quote を抜き出させ、
 * 残りの欄を決定的に補う。返ってきた quote は必ず `parse` に通してから返す。
 * 録音は保存しない。
 *
 * 任意の `text` を受け取ったときは文字起こしを呼ばず、その文字だけで割当を行う
 * （区間送信で全文が手元にある場合）。`audio` は `text` があるとき任意になる。
 *
 * 応答は `text/event-stream`。`delta`（音声から文字起こししたときだけ）と
 * `done` を返す。途中の `cell` は返さない（自然文では途中の割当が誤るため）。
 */
export async function POST(req: NextRequest) {
  try {
    const contentType = req.headers.get("content-type") ?? "";
    if (!contentType.toLowerCase().includes("multipart/form-data")) {
      throw new ProblemDetailException({
        status: 415,
        title: "Unsupported Media Type",
        detail: "音声は multipart/form-data で送ってください。",
      });
    }

    let form: FormData;
    try {
      form = await req.formData();
    } catch {
      throw new ProblemDetailException({
        status: 400,
        title: "Validation Error",
        detail: "音声を読み取れませんでした。もう一度お試しください。",
      });
    }

    // 区間の文字起こしをまとめた全文。あればこちらを割当に使い、音声は読まない。
    const providedText = parseProvidedText(form.get("text"));

    const audio = form.get("audio");
    const audioBlob = audio instanceof Blob && audio.size > 0 ? audio : null;
    if (!audioBlob && providedText === null) {
      throw new ProblemDetailException({
        status: 400,
        title: "Validation Error",
        detail: "音声が空です。マイクに向かって話してから、もう一度お試しください。",
      });
    }
    if (audioBlob && audioBlob.size > MAX_AUDIO_BYTES) {
      throw new ProblemDetailException({
        status: 413,
        title: "Payload Too Large",
        detail: "録音が長すぎます。1 回の入力は 5MB までにしてください。",
      });
    }

    const audioType = audioBlob?.type || "audio/webm";
    if (
      audioBlob &&
      !audioType.startsWith("audio/") &&
      audioType !== "application/octet-stream"
    ) {
      throw new ProblemDetailException({
        status: 415,
        title: "Unsupported Media Type",
        detail: "音声以外のファイルは送れません。",
      });
    }

    const value = parseFormValue(form.get("value"));
    if (!value) {
      throw new ProblemDetailException({
        status: 400,
        title: "Validation Error",
        detail: "フォームの値を読み取れませんでした。画面を開き直してお試しください。",
      });
    }
    const scope = parseScope(form.get("scope"));

    const mock = isVoiceMockEnabled();
    // 課金を守るため、認識を呼ぶ前に 1 回ぶん消費する。モックは外部を呼ばないので数えない。
    if (!mock) consumeVoiceRateLimit(clientIp(req) ?? "local");

    // 画面が切れたら上流も切る。`req.signal` とストリームの `cancel()` の両方から止める。
    const abort = new AbortController();
    const onRequestAbort = (): void => abort.abort();
    if (req.signal.aborted) abort.abort();
    else req.signal.addEventListener("abort", onRequestAbort, { once: true });

    const encoder = new TextEncoder();
    let closed = false;

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        /** 1 イベントを書き出す。閉じたあとの書き込みは捨てる。 */
        const send = (event: string, payload: unknown): void => {
          if (closed || abort.signal.aborted) return;
          try {
            controller.enqueue(
              encoder.encode(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`),
            );
          } catch {
            closed = true;
          }
        };

        try {
          let text: string;
          let model: string;
          if (providedText !== null) {
            // 全文が手元にある。文字起こしを呼ばず、done だけを返す。
            text = providedText;
            model = mock ? "mock" : "text";
          } else if (mock) {
            text = mockBatchTranscript(value, scope);
            model = "mock";
            // 疑似でも話している途中のように、文ごとに区切って流す。
            for (const chunk of text.match(/[^。！？]+[。！？]?/gu) ?? [text]) {
              send("delta", { text: chunk });
            }
          } else {
            if (!audioBlob) throw new Error("音声がありません");
            const bytes = new Uint8Array(await audioBlob.arrayBuffer());
            const transcription = await transcribeDetailed({
              bytes,
              contentType: audioType,
              filename: filenameFor(audioType),
              // 自由に話すときは欄を決めない。入力済みの名前だけを当て字の手掛かりにする。
              field: null,
              title: value.title || null,
              venueName: value.venueName || null,
              onDelta: (delta) => send("delta", { text: delta }),
              signal: abort.signal,
            });
            text = transcription.text;
            // 控えのモデルへ落ちたときも、実際に使った名前を返す。
            model = transcription.model;
          }

          const result = await assignBatch(text, { now: new Date(), value, scope });
          send("done", {
            text,
            assignments: result.assignments,
            unassigned: result.unassigned,
            model,
          });
        } catch (error) {
          // 本文は流れ始めているため、ステータスは変えず error イベントで知らせる。
          send("error", streamFailure(error));
        } finally {
          req.signal.removeEventListener("abort", onRequestAbort);
          try {
            if (!closed) controller.close();
          } catch {
            // すでに閉じている（画面が切れた）ときは何もしない。
          }
        }
      },
      cancel() {
        closed = true;
        abort.abort();
      },
    });

    return new Response(stream, {
      status: 200,
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-store, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      },
    });
  } catch (error) {
    // ストリームを始める前の失敗は、従来どおり problem+json で返す。
    return toErrorResponse(error, INSTANCE);
  }
}

/**
 * ストリームが始まったあとの失敗を、自前プロトコルの `error` イベントへ変える。
 * ステータスコードは変えられない（本文はすでに流れている）ため、コードと文言だけを返す。
 */
function streamFailure(error: unknown): { error: string; detail: string } {
  if (error instanceof ProblemDetailException) {
    const code =
      typeof error.extras.error === "string" ? error.extras.error : "TRANSCRIBE_FAILED";
    return { error: code, detail: error.detail };
  }
  console.error("[voice] batch stream failed", error);
  return {
    error: "TRANSCRIBE_FAILED",
    detail: "音声を文字にできませんでした。手で入力してください。",
  };
}
