import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { ProblemDetailException } from "@/lib/exceptions";
import { toErrorResponse } from "@/lib/http";
import { clientIp } from "@/modules/auth/lib/cookies";
import { MAX_AUDIO_BYTES } from "@/modules/events/lib/voice/audio";
import { assignBatch, mockBatchTranscript } from "@/modules/events/lib/voice/batch";
import { VOICE_FIELD_KEYS } from "@/modules/events/lib/voice/fields";
import {
  isVoiceMockEnabled,
  warnVoiceConfigurationOnce,
} from "@/modules/events/lib/voice/mock";
import { transcribeDetailed } from "@/modules/events/lib/voice/openai";
import { consumeVoiceRateLimit } from "@/modules/events/lib/voice/rate-limit";
import type { VoiceFieldKey, VoiceFieldScope } from "@/modules/events/lib/voice/types";
import {
  EMPTY_EVENT_FORM,
  MAX_EVENT_OPTIONS,
  type EventFormValues,
} from "@/modules/events/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const INSTANCE = "/api/v1/voice/utterances";

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
 * 1 回の発話から、複数の欄をまとめて埋める。
 *
 * 文字起こしは 1 回だけ。決定的に割り当てられなかった節だけを LLM へ回し、
 * 返ってきた節は必ず `parse` に通してから返す。録音は保存しない。
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

    const audio = form.get("audio");
    if (!(audio instanceof Blob) || audio.size === 0) {
      throw new ProblemDetailException({
        status: 400,
        title: "Validation Error",
        detail: "音声が空です。マイクに向かって話してから、もう一度お試しください。",
      });
    }
    if (audio.size > MAX_AUDIO_BYTES) {
      throw new ProblemDetailException({
        status: 413,
        title: "Payload Too Large",
        detail: "録音が長すぎます。1 回の入力は 5MB までにしてください。",
      });
    }

    const audioType = audio.type || "audio/webm";
    if (!audioType.startsWith("audio/") && audioType !== "application/octet-stream") {
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

    let text: string;
    let model: string;
    if (mock) {
      text = mockBatchTranscript(value, scope);
      model = "mock";
    } else {
      const bytes = new Uint8Array(await audio.arrayBuffer());
      const transcription = await transcribeDetailed({
        bytes,
        contentType: audioType,
        filename: filenameFor(audioType),
        // まとめて話すときは欄を決めない。入力済みの名前だけを当て字の手掛かりにする。
        field: null,
        title: value.title || null,
        venueName: value.venueName || null,
      });
      text = transcription.text;
      // 控えのモデルへ落ちたときも、実際に使った名前を返す。
      model = transcription.model;
    }

    const result = await assignBatch(text, { now: new Date(), value, scope });

    return NextResponse.json(
      {
        text,
        assignments: result.assignments,
        unassigned: result.unassigned,
        model,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return toErrorResponse(error, INSTANCE);
  }
}
