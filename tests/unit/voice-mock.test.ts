import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/v1/voice/transcriptions/route";
import { VOICE_FIELDS } from "@/modules/events/lib/voice/fields";
import { isVoiceMockEnabled, mockTranscript } from "@/modules/events/lib/voice/mock";
import {
  isVoiceTranscriptionConfigured,
  transcribeWithOpenAi,
} from "@/modules/events/lib/voice/openai";
import type { VoiceContext } from "@/modules/events/lib/voice/types";
import { EMPTY_EVENT_FORM } from "@/modules/events/types";

/** 相対日付の解決を固定するための「今日」。 */
const NOW = new Date("2026-10-24T09:00:00+09:00");

function context(): VoiceContext {
  return { now: NOW, value: EMPTY_EVENT_FORM };
}

/** 録音 1 件ぶんのリクエスト。音声の中身はモックでは使わない。 */
function request(field: string | null, ip = "203.0.113.1"): NextRequest {
  const form = new FormData();
  form.append("audio", new File([new Uint8Array([1, 2, 3])], "voice.webm", { type: "audio/webm" }));
  if (field) form.append("field", field);
  return new NextRequest("http://localhost:3012/api/v1/voice/transcriptions", {
    method: "POST",
    body: form,
    headers: { "cf-connecting-ip": ip },
  });
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("モックの有効判定", () => {
  it("VOICE_TRANSCRIBE_MOCK が未設定なら無効", () => {
    vi.stubEnv("VOICE_TRANSCRIBE_MOCK", "");
    expect(isVoiceMockEnabled()).toBe(false);
  });

  it("VOICE_TRANSCRIBE_MOCK=1 のときだけ有効", () => {
    vi.stubEnv("VOICE_TRANSCRIBE_MOCK", "1");
    expect(isVoiceMockEnabled()).toBe(true);
    vi.stubEnv("VOICE_TRANSCRIBE_MOCK", "true");
    expect(isVoiceMockEnabled()).toBe(false);
  });

  it("本番では 1 でも無効", () => {
    vi.stubEnv("VOICE_TRANSCRIBE_MOCK", "1");
    vi.stubEnv("NODE_ENV", "production");
    expect(isVoiceMockEnabled()).toBe(false);
  });

  it("モックが有効なら鍵が無くても設定済みとみなす", () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    vi.stubEnv("VOICE_TRANSCRIBE_MOCK", "");
    expect(isVoiceTranscriptionConfigured()).toBe(false);
    vi.stubEnv("VOICE_TRANSCRIBE_MOCK", "1");
    expect(isVoiceTranscriptionConfigured()).toBe(true);
  });
});

describe("モックの認識結果", () => {
  it("欄の入力例をそのまま返す", () => {
    expect(mockTranscript("scheduleDate")).toBe("12月5日");
    expect(mockTranscript("planAmount")).toBe("3000円");
  });

  it("欄が無ければ読める文字を返す", () => {
    expect(mockTranscript(null)).toBe("テスト");
  });

  it("すべての欄の入力例が、その欄の規則で読める", () => {
    for (const field of VOICE_FIELDS) {
      const patch = field.parse(mockTranscript(field.key), context());
      expect(patch, `${field.key} の入力例「${field.example}」を読めない`).not.toBeNull();
    }
  });
});

describe("モックのときの問い合わせ", () => {
  it("鍵が無くても外部を呼ばずに文字を返す", async () => {
    vi.stubEnv("VOICE_TRANSCRIBE_MOCK", "1");
    vi.stubEnv("OPENAI_API_KEY", "");
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const text = await transcribeWithOpenAi({
      bytes: new Uint8Array([1, 2, 3]),
      contentType: "audio/webm",
      filename: "voice.webm",
      field: "title",
    });

    expect(text).toBe("忘年会");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("モックが無効で鍵も無ければ 503 で止まる", async () => {
    vi.stubEnv("VOICE_TRANSCRIBE_MOCK", "");
    vi.stubEnv("OPENAI_API_KEY", "");
    await expect(
      transcribeWithOpenAi({
        bytes: new Uint8Array([1, 2, 3]),
        contentType: "audio/webm",
        filename: "voice.webm",
        field: "title",
      }),
    ).rejects.toMatchObject({ status: 503, extras: { error: "TRANSCRIBE_DISABLED" } });
  });
});

describe("モックのときの API", () => {
  it("200 で欄の入力例と model=mock を返す", async () => {
    vi.stubEnv("VOICE_TRANSCRIBE_MOCK", "1");
    vi.stubEnv("OPENAI_API_KEY", "");

    const response = await POST(request("planAmount"));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ text: "3000円", model: "mock" });
  });

  it("回数の上限を数えない", async () => {
    vi.stubEnv("VOICE_TRANSCRIBE_MOCK", "1");
    vi.stubEnv("VOICE_TRANSCRIBE_LIMIT", "1");

    // 上限 1 回でも、モックは何度でも通る。
    for (let index = 0; index < 3; index += 1) {
      expect((await POST(request("title", "198.51.100.7"))).status).toBe(200);
    }

    // モックを切ると、同じ接続元は 2 回目で止まる（数えているのは本物の経路）。
    vi.stubEnv("VOICE_TRANSCRIBE_MOCK", "");
    vi.stubEnv("OPENAI_API_KEY", "sk-test");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ text: "忘年会" })),
    );
    expect((await POST(request("title", "198.51.100.7"))).status).toBe(200);
    expect((await POST(request("title", "198.51.100.7"))).status).toBe(429);
  });
});
