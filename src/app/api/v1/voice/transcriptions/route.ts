import { NextRequest, NextResponse } from "next/server";
import { ProblemDetailException } from "@/lib/exceptions";
import { toErrorResponse } from "@/lib/http";
import { clientIp } from "@/modules/auth/lib/cookies";
import { MAX_AUDIO_BYTES } from "@/modules/events/lib/voice/audio";
import { VOICE_FIELD_KEYS } from "@/modules/events/lib/voice/fields";
import { isVoiceMockEnabled, warnVoiceConfigurationOnce } from "@/modules/events/lib/voice/mock";
import { transcribeWithOpenAi, voiceModel } from "@/modules/events/lib/voice/openai";
import { consumeVoiceRateLimit } from "@/modules/events/lib/voice/rate-limit";
import type { VoiceFieldKey } from "@/modules/events/lib/voice/types";
import { MAX_EVENT_OPTIONS } from "@/modules/events/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const INSTANCE = "/api/v1/voice/transcriptions";

// このルートが読み込まれたとき（開発では初回アクセス時）に、設定を 1 度だけ知らせる。
// テストでは毎回の出力が警告で埋まるため呼ばない。
if (process.env.NODE_ENV !== "test") warnVoiceConfigurationOnce();

function isVoiceFieldKey(value: string): value is VoiceFieldKey {
  return (VOICE_FIELD_KEYS as readonly string[]).includes(value);
}

/** 当て字の手掛かりとして受け取る長さの上限。 */
const MAX_CLUE_LENGTH = 60;

/**
 * 行の番号。範囲内の整数だけを受け、それ以外は null（文脈なし）にする。
 * 文脈は補助なので、検証に落ちても認識は続ける。
 */
function parseRow(raw: FormDataEntryValue | null): number | null {
  if (typeof raw !== "string" || !/^\d{1,2}$/u.test(raw)) return null;
  const row = Number(raw);
  return row < MAX_EVENT_OPTIONS ? row : null;
}

/**
 * 入力済みの催し名・会場名。改行と制御文字は空白へ潰し、60 文字で切る。
 * プロンプトへは固定文の一部として差し込むだけで、そのまま連結しない。
 */
function parseClue(raw: FormDataEntryValue | null): string | null {
  if (typeof raw !== "string") return null;
  const text = raw
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_CLUE_LENGTH)
    .trim();
  return text ? text : null;
}

/** 音声の形式から拡張子を決める。OpenAI は拡張子で形式を見る。 */
function filenameFor(contentType: string): string {
  if (contentType.includes("mp4")) return "voice.m4a";
  if (contentType.includes("ogg")) return "voice.ogg";
  if (contentType.includes("wav")) return "voice.wav";
  if (contentType.includes("mpeg")) return "voice.mp3";
  return "voice.webm";
}

/**
 * いまの音声入力の設定。
 *
 * モックかどうかはサーバーの環境変数が決める。画面は「録音を省いてよいか」を知るために、
 * 音声モードを開いたときに 1 度だけここへ聞く。音声そのものは受け取らない。
 */
export async function GET() {
  return NextResponse.json(
    { mock: isVoiceMockEnabled() },
    { headers: { "Cache-Control": "no-store" } },
  );
}

/**
 * 音声を文字にする。
 *
 * このルートは録音を保存しない。受け取った音声をそのまま OpenAI へ中継し、
 * 返ってきた文字だけを返す。鍵はサーバーに閉じ込める。
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

    const rawField = form.get("field");
    const field =
      typeof rawField === "string" && isVoiceFieldKey(rawField) ? rawField : null;
    // 欄の文脈。検証を通らない値は捨て、認識そのものは続ける。
    const row = parseRow(form.get("row"));
    const title = parseClue(form.get("title"));
    const venueName = parseClue(form.get("venueName"));

    // 課金を守るため、認識を呼ぶ前に 1 回ぶん消費する。
    // モックは外部を呼ばないので数えない（開発中に 429 で止まらないようにする）。
    if (!isVoiceMockEnabled()) {
      consumeVoiceRateLimit(clientIp(req) ?? "local");
    }

    const bytes = new Uint8Array(await audio.arrayBuffer());
    const text = await transcribeWithOpenAi({
      bytes,
      contentType: audioType,
      filename: filenameFor(audioType),
      field,
      row: row ?? undefined,
      title,
      venueName,
    });

    return NextResponse.json(
      { text, model: isVoiceMockEnabled() ? "mock" : voiceModel() },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return toErrorResponse(error, INSTANCE);
  }
}
