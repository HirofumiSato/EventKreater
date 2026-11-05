import { NextRequest, NextResponse } from "next/server";
import { ProblemDetailException } from "@/lib/exceptions";
import { toErrorResponse } from "@/lib/http";
import { clientIp } from "@/modules/auth/lib/cookies";
import { MAX_AUDIO_BYTES } from "@/modules/events/lib/voice/audio";
import { VOICE_FIELD_KEYS } from "@/modules/events/lib/voice/fields";
import { isVoiceMockEnabled, warnVoiceConfigurationOnce } from "@/modules/events/lib/voice/mock";
import { assertVoiceConfigured, transcribeDetailed } from "@/modules/events/lib/voice/openai";
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
 * ストリームが始まったあとの失敗を、自前プロトコルの `error` イベントへ変える。
 * ステータスコードは変えられない（本文はすでに流れている）ため、コードと文言だけを返す。
 */
function streamFailure(error: unknown): { error: string; detail: string } {
  if (error instanceof ProblemDetailException) {
    const code =
      typeof error.extras.error === "string" ? error.extras.error : "TRANSCRIBE_FAILED";
    return { error: code, detail: error.detail };
  }
  console.error("[voice] stream failed", error);
  return {
    error: "TRANSCRIBE_FAILED",
    detail: "音声を文字にできませんでした。手で入力してください。",
  };
}

/**
 * 音声を文字にする。
 *
 * このルートは録音を保存しない。受け取った音声をそのまま OpenAI へ中継し、
 * 返ってきた文字だけを返す。鍵はサーバーに閉じ込める。
 *
 * 検証（multipart・空・5MB・形式・回数上限）がすべて通ったあとだけ
 * `text/event-stream` を返す。検証の失敗は従来どおり `application/problem+json` で返す。
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

    // 鍵もモックも無ければ、本文を流し始める前に 503 で止める。
    // 流し始めたあとはステータスを変えられないため、ここで確かめる。
    assertVoiceConfigured();

    const bytes = new Uint8Array(await audio.arrayBuffer());

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
            // 画面が切れて閉じたあとの書き込みは捨てる。
            closed = true;
          }
        };

        try {
          const result = await transcribeDetailed({
            bytes,
            contentType: audioType,
            filename: filenameFor(audioType),
            field,
            row: row ?? undefined,
            title,
            venueName,
            onDelta: (text) => send("delta", { text }),
            signal: abort.signal,
          });
          send("done", { text: result.text, model: result.model });
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
        // 画面が切れたら、上流の読み取りも止める。
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
