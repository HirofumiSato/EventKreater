import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { POST, GET } from "@/app/api/v1/voice/transcriptions/route";
import { VOICE_FIELDS } from "@/modules/events/lib/voice/fields";
import { isVoiceMockEnabled, mockTranscript } from "@/modules/events/lib/voice/mock";
import {
  isVoiceTranscriptionConfigured,
  transcribeWithOpenAi,
} from "@/modules/events/lib/voice/openai";
import { createSseParser, type SseEvent } from "@/modules/events/lib/voice/sse";
import { fetchVoiceMockEnabled } from "@/modules/events/lib/voice/transcribe";
import type { VoiceContext } from "@/modules/events/lib/voice/types";
import { EMPTY_EVENT_FORM } from "@/modules/events/types";

/** 相対日付の解決を固定するための「今日」。 */
const NOW = new Date("2026-10-24T09:00:00+09:00");

function context(): VoiceContext {
  return { now: NOW, value: EMPTY_EVENT_FORM };
}

/** 応答の本文を SSE のイベント列にする。 */
async function readEvents(response: Response): Promise<SseEvent[]> {
  const text = await response.text();
  const parser = createSseParser();
  return [...parser.push(text), ...parser.flush()];
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
  it("200 で text/event-stream を返し、delta 1 回と done を流す", async () => {
    vi.stubEnv("VOICE_TRANSCRIBE_MOCK", "1");
    vi.stubEnv("OPENAI_API_KEY", "");

    const response = await POST(request("planAmount"));

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    await expect(readEvents(response)).resolves.toEqual([
      { event: "delta", data: '{"text":"3000円"}' },
      { event: "done", data: '{"text":"3000円","model":"mock"}' },
    ]);
  });

  it("ストリームを始める前の失敗は problem+json のまま返す", async () => {
    vi.stubEnv("VOICE_TRANSCRIBE_MOCK", "1");
    vi.stubEnv("OPENAI_API_KEY", "");

    // 音声が空。本文を流し始めないので、ステータスで失敗を返せる。
    const form = new FormData();
    form.append("audio", new File([new Uint8Array(0)], "voice.webm", { type: "audio/webm" }));
    const req = new NextRequest("http://localhost:3012/api/v1/voice/transcriptions", {
      method: "POST",
      body: form,
    });

    const response = await POST(req);

    expect(response.status).toBe(400);
    expect(response.headers.get("content-type")).toContain("application/problem+json");
  });

  it("鍵もモックも無ければ、ストリームを始めず 503 を返す", async () => {
    vi.stubEnv("VOICE_TRANSCRIBE_MOCK", "");
    vi.stubEnv("OPENAI_API_KEY", "");

    const response = await POST(request("title", "203.0.113.42"));

    expect(response.status).toBe(503);
    expect(response.headers.get("content-type")).toContain("application/problem+json");
    await expect(response.json()).resolves.toMatchObject({ error: "TRANSCRIBE_DISABLED" });
  });

  it("上流の delta を自前の delta として中継する", async () => {
    vi.stubEnv("VOICE_TRANSCRIBE_MOCK", "");
    vi.stubEnv("OPENAI_API_KEY", "sk-test");
    const upstream = [
      'event: transcript.text.delta\ndata: {"type":"transcript.text.delta","delta":"忘年"}\n\n',
      'event: transcript.text.done\ndata: {"type":"transcript.text.done","text":"忘年会"}\n\n',
    ].join("");
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(upstream, { headers: { "Content-Type": "text/event-stream" } }),
      ),
    );

    const response = await POST(request("title", "203.0.113.40"));

    expect(response.status).toBe(200);
    await expect(readEvents(response)).resolves.toEqual([
      { event: "delta", data: '{"text":"忘年"}' },
      { event: "done", data: '{"text":"忘年会","model":"gpt-transcribe"}' },
    ]);
  });

  it("流れ始めたあとの失敗は error イベントで返す", async () => {
    vi.stubEnv("VOICE_TRANSCRIBE_MOCK", "");
    vi.stubEnv("OPENAI_API_KEY", "sk-test");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("network");
      }),
    );

    const response = await POST(request("title", "203.0.113.41"));

    // 本文は流れ始めているので、ステータスは 200 のまま。
    expect(response.status).toBe(200);
    const events = await readEvents(response);
    expect(events).toHaveLength(1);
    expect(events[0].event).toBe("error");
    const payload = JSON.parse(events[0].data) as { error?: string; detail?: string };
    expect(payload.error).toBe("TRANSCRIBE_FAILED");
    expect(payload.detail).toBeTruthy();
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

describe("モックの可否を画面へ渡す", () => {
  it("GET はモックの可否だけを返す", async () => {
    vi.stubEnv("VOICE_TRANSCRIBE_MOCK", "1");
    const response = await GET();
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ mock: true });
  });

  it("モックでなければ false を返す", async () => {
    vi.stubEnv("VOICE_TRANSCRIBE_MOCK", "");
    await expect((await GET()).json()).resolves.toEqual({ mock: false });
  });

  it("画面は GET の返事を読む", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ mock: true })));
    await expect(fetchVoiceMockEnabled()).resolves.toBe(true);
  });

  it("読めなければ false（実の録音）に倒す", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 500 })));
    await expect(fetchVoiceMockEnabled()).resolves.toBe(false);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("network");
      }),
    );
    await expect(fetchVoiceMockEnabled()).resolves.toBe(false);
  });

  it("返事が遅ければ 1.5 秒で打ち切って false（実の録音）に倒す", async () => {
    vi.useFakeTimers();
    try {
      // 返事を返さないまま待たせる。打ち切られたときだけ、中断として reject する。
      const fetchMock = vi.fn(
        (_url: string, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => {
              reject(new DOMException("aborted", "AbortError"));
            });
          }),
      );
      vi.stubGlobal("fetch", fetchMock);

      const pending = fetchVoiceMockEnabled();
      expect(fetchMock.mock.calls[0][1]?.signal).toBeInstanceOf(AbortSignal);

      // 打ち切りまでは待つ（録音の開始を、返事の速さに左右させない）。
      await vi.advanceTimersByTimeAsync(1_000);
      await expect(Promise.race([pending, Promise.resolve("waiting")])).resolves.toBe("waiting");

      // 超えたら実の録音に倒れる。待ちが残らないよう、返事は false で返す。
      await vi.advanceTimersByTimeAsync(600);
      await expect(pending).resolves.toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("起動時のログ", () => {
  /** `warned` の印はモジュールに載るので、毎回読み直して新しい状態から始める。 */
  async function freshWarn(): Promise<() => void> {
    vi.resetModules();
    const fresh = await import("@/modules/events/lib/voice/mock");
    return fresh.warnVoiceConfigurationOnce;
  }

  it("モックが有効なら、そう出して OpenAI を呼ばないと知らせる", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubEnv("VOICE_TRANSCRIBE_MOCK", "1");
    vi.stubEnv("OPENAI_API_KEY", "sk-test");

    (await freshWarn())();

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain("モックが有効です");
    warn.mockRestore();
  });

  it("鍵が無ければ 503 になると知らせる", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubEnv("VOICE_TRANSCRIBE_MOCK", "");
    vi.stubEnv("OPENAI_API_KEY", "");

    (await freshWarn())();

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain("OPENAI_API_KEY が未設定");
    warn.mockRestore();
  });

  it("鍵がある通常の設定では黙っている", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubEnv("VOICE_TRANSCRIBE_MOCK", "");
    vi.stubEnv("OPENAI_API_KEY", "sk-test");

    (await freshWarn())();

    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it("本番では出さない", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubEnv("VOICE_TRANSCRIBE_MOCK", "1");
    vi.stubEnv("NODE_ENV", "production");

    (await freshWarn())();

    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it("同じプロセスでは 1 度しか出さない", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubEnv("VOICE_TRANSCRIBE_MOCK", "1");

    const once = await freshWarn();
    once();
    once();
    once();

    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });
});
