import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { POST as postTranscription } from "@/app/api/v1/voice/transcriptions/route";
import { transcribeDetailed } from "@/modules/events/lib/voice/openai";
import { transcribeVoiceClip } from "@/modules/events/lib/voice/transcribe";
import { transcribeVoiceUtterance } from "@/modules/events/lib/voice/utterance-client";
import { EMPTY_EVENT_FORM } from "@/modules/events/types";

/** 録音 1 件ぶん。中身は認識の入口では使わない。 */
function clip(): Blob {
  return new Blob([new Uint8Array([1, 2, 3])], { type: "audio/webm" });
}

function sseResponse(body: string): Response {
  return new Response(body, {
    headers: { "Content-Type": "text/event-stream; charset=utf-8" },
  });
}

/** 上流の 1 モデルぶんの入力。`onDelta` の有無で stream の送り方が変わる。 */
function upstreamInput(onDelta?: (text: string) => void) {
  return {
    bytes: new Uint8Array([1, 2, 3]),
    contentType: "audio/webm",
    filename: "voice.webm",
    field: "title" as const,
    onDelta,
  };
}

/** 送った FormData を取り出す。 */
function sentForm(fetchMock: { mock: { calls: unknown[][] } }, index = 0): FormData {
  const init = fetchMock.mock.calls[index]?.[1] as RequestInit | undefined;
  return init?.body as FormData;
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("上流のストリーミング（openai.ts）", () => {
  it("onDelta があると stream=true を送り、増分を渡して done の全文を返す", async () => {
    const upstream = [
      'event: transcript.text.delta\ndata: {"type":"transcript.text.delta","delta":"忘年"}\n\n',
      'event: transcript.text.delta\ndata: {"type":"transcript.text.delta","delta":"会"}\n\n',
      'event: transcript.text.done\ndata: {"type":"transcript.text.done","text":"忘年会"}\n\n',
    ].join("");
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => sseResponse(upstream));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("VOICE_TRANSCRIBE_MOCK", "");
    vi.stubEnv("OPENAI_API_KEY", "sk-test");

    const deltas: string[] = [];
    const result = await transcribeDetailed(
      upstreamInput((text) => {
        deltas.push(text);
      }),
    );

    expect(result).toEqual({ text: "忘年会", model: "gpt-transcribe" });
    expect(deltas).toEqual(["忘年", "会"]);
    expect(sentForm(fetchMock).get("stream")).toBe("true");
  });

  it("onDelta が無ければ stream を送らず、JSON を 1 回で読む", async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) =>
      Response.json({ text: "忘年会" }),
    );
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("VOICE_TRANSCRIBE_MOCK", "");
    vi.stubEnv("OPENAI_API_KEY", "sk-test");

    const result = await transcribeDetailed(upstreamInput());

    expect(result).toEqual({ text: "忘年会", model: "gpt-transcribe" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(sentForm(fetchMock).get("stream")).toBeNull();
  });

  it("event 名が message でも本文の type で読む", async () => {
    const upstream = [
      'event: message\ndata: {"type":"transcript.text.delta","delta":"忘年"}\n\n',
      'event: message\ndata: {"type":"transcript.text.delta","text":"会"}\n\n',
    ].join("");
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, _init?: RequestInit) => sseResponse(upstream)),
    );
    vi.stubEnv("VOICE_TRANSCRIBE_MOCK", "");
    vi.stubEnv("OPENAI_API_KEY", "sk-test");

    const result = await transcribeDetailed(upstreamInput(() => undefined));

    expect(result.text).toBe("忘年会");
    expect(result.model).toBe("gpt-transcribe");
  });

  it("done が無ければ増分を連結し、知らない type は捨てる", async () => {
    const upstream = [
      'event: transcript.text.delta\ndata: {"delta":"3000円。"}\n\n',
      'event: transcript.text.heartbeat\ndata: {"delta":"無視"}\n\n',
    ].join("");
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, _init?: RequestInit) => sseResponse(upstream)),
    );
    vi.stubEnv("VOICE_TRANSCRIBE_MOCK", "");
    vi.stubEnv("OPENAI_API_KEY", "sk-test");

    const result = await transcribeDetailed(upstreamInput(() => undefined));

    // 増分を連結したあと、末尾の句読点だけを落とす。
    expect(result.text).toBe("3000円");
  });

  it("上流が stream を知らなければ、stream 無しで 1 回だけやり直す", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ error: { message: "stream is not supported", param: "stream" } }),
          { status: 400, headers: { "Content-Type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(Response.json({ text: "忘年会" }));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("VOICE_TRANSCRIBE_MOCK", "");
    vi.stubEnv("OPENAI_API_KEY", "sk-test");

    const result = await transcribeDetailed(upstreamInput(() => undefined));

    expect(result).toEqual({ text: "忘年会", model: "gpt-transcribe" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(sentForm(fetchMock, 0).get("stream")).toBe("true");
    expect(sentForm(fetchMock, 1).get("stream")).toBeNull();
  });

  it("控えのモデルへ落ちたときは、実際に使ったモデル名を返す", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ error: { code: "model_not_found", message: "The model does not exist" } }),
          { status: 404, headers: { "Content-Type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(Response.json({ text: "忘年会" }));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("VOICE_TRANSCRIBE_MOCK", "");
    vi.stubEnv("OPENAI_API_KEY", "sk-test");
    vi.stubEnv("VOICE_TRANSCRIBE_FALLBACK_MODEL", "gpt-4o-mini-transcribe");

    const result = await transcribeDetailed(upstreamInput(() => undefined));

    expect(result).toEqual({ text: "忘年会", model: "gpt-4o-mini-transcribe" });
    expect(sentForm(fetchMock, 1).get("model")).toBe("gpt-4o-mini-transcribe");
    // 控えは旧系統なので、語彙ではなく language だけを送る。
    expect(sentForm(fetchMock, 1).get("language")).toBe("ja");
  });

  it("最初の delta が 10 秒来なければ打ち切る", async () => {
    vi.useFakeTimers();
    vi.stubEnv("VOICE_TRANSCRIBE_MOCK", "");
    vi.stubEnv("OPENAI_API_KEY", "sk-test");
    const fetchMock = vi.fn(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(new DOMException("aborted", "AbortError"));
          });
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const pending = transcribeDetailed(upstreamInput(() => undefined));
    const checked = expect(pending).rejects.toMatchObject({
      status: 502,
      extras: { error: "TRANSCRIBE_FAILED" },
    });

    // 1 秒では切らない。
    await vi.advanceTimersByTimeAsync(1_000);
    // 10 秒を超えたら切る。
    await vi.advanceTimersByTimeAsync(9_000);
    await checked;
  });

  it("delta の間が 15 秒空いたら打ち切る", async () => {
    vi.useFakeTimers();
    vi.stubEnv("VOICE_TRANSCRIBE_MOCK", "");
    vi.stubEnv("OPENAI_API_KEY", "sk-test");
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(
            new TextEncoder().encode('event: transcript.text.delta\ndata: {"delta":"忘"}\n\n'),
          );
          init?.signal?.addEventListener("abort", () => {
            controller.error(new DOMException("aborted", "AbortError"));
          });
        },
      });
      return new Response(stream, { headers: { "Content-Type": "text/event-stream" } });
    });
    vi.stubGlobal("fetch", fetchMock);

    const deltas: string[] = [];
    const pending = transcribeDetailed(
      upstreamInput((text) => {
        deltas.push(text);
      }),
    );
    const checked = expect(pending).rejects.toMatchObject({
      status: 502,
      extras: { error: "TRANSCRIBE_FAILED" },
    });

    // 最初の delta までは読めている。
    await vi.advanceTimersByTimeAsync(10);
    expect(deltas).toEqual(["忘"]);

    // delta 間は 15 秒。14 秒では切らず、超えたら切る。
    await vi.advanceTimersByTimeAsync(14_000);
    await vi.advanceTimersByTimeAsync(1_000);
    await checked;
  });
});

describe("画面から送る文字起こし（transcribe.ts）", () => {
  it("delta を順に onDelta へ渡し、done の本文を返す", async () => {
    const body = [
      'event: delta\ndata: {"text":"12月"}\n\n',
      'event: delta\ndata: {"text":"5日"}\n\n',
      'event: done\ndata: {"text":"12月5日","model":"gpt-transcribe"}\n\n',
    ].join("");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => sseResponse(body)),
    );

    const deltas: string[] = [];
    const result = await transcribeVoiceClip({
      blob: clip(),
      field: "scheduleDate",
      onDelta: (text) => {
        deltas.push(text);
      },
    });

    expect(deltas).toEqual(["12月", "5日"]);
    expect(result).toEqual({ text: "12月5日" });
  });

  it("done が無ければ delta を連結して返す", async () => {
    const body = [
      'event: delta\ndata: {"text":"3000"}\n\n',
      'event: delta\ndata: {"text":"円"}\n\n',
    ].join("");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => sseResponse(body)),
    );

    await expect(
      transcribeVoiceClip({ blob: clip(), field: "planAmount" }),
    ).resolves.toEqual({ text: "3000円" });
  });

  it("error イベントは detail の Error にして投げる", async () => {
    const body = 'event: error\ndata: {"error":"TRANSCRIBE_FAILED","detail":"もう一度話してください"}\n\n';
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => sseResponse(body)),
    );

    await expect(
      transcribeVoiceClip({ blob: clip(), field: "title" }),
    ).rejects.toThrow("もう一度話してください");
  });

  it("text/event-stream でなければ JSON を読む（プロキシがためた場合）", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ text: "3000円" })),
    );

    await expect(
      transcribeVoiceClip({ blob: clip(), field: "planAmount" }),
    ).resolves.toEqual({ text: "3000円" });
  });

  it("失敗の応答は problem+json の detail を Error にする", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ detail: "録音が長すぎます。短く話してください。" }), {
            status: 413,
            headers: { "Content-Type": "application/problem+json" },
          }),
      ),
    );

    await expect(
      transcribeVoiceClip({ blob: clip(), field: "title" }),
    ).rejects.toThrow("録音が長すぎます。短く話してください。");
  });

  it("signal を fetch へ渡し、中断したら成功にしない", async () => {
    const controller = new AbortController();
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      expect(init?.signal).toBe(controller.signal);
      return Response.json({ text: "忘年会" });
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      transcribeVoiceClip({ blob: clip(), field: "title", signal: controller.signal }),
    ).resolves.toEqual({ text: "忘年会" });

    // 中断済みの signal では、本文が揃っていなくても成功にしない。
    const aborted = new AbortController();
    aborted.abort();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => sseResponse("")),
    );
    await expect(
      transcribeVoiceClip({ blob: clip(), field: "title", signal: aborted.signal }),
    ).rejects.toMatchObject({ name: "AbortError" });
  });

  it("本文が 1 つも無ければ失敗にする", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => sseResponse("")),
    );

    await expect(
      transcribeVoiceClip({ blob: clip(), field: "title" }),
    ).rejects.toThrow("音声を文字にできませんでした");
  });
});

/** 区間送信 1 本ぶん。`sessionId` は任意。 */
function segmentRequest(ip: string, sessionId?: string): NextRequest {
  const form = new FormData();
  form.append("audio", new File([new Uint8Array([1, 2, 3])], "voice.webm", {
    type: "audio/webm",
  }));
  if (sessionId) form.append("sessionId", sessionId);
  return new NextRequest("http://localhost:3012/api/v1/voice/transcriptions", {
    method: "POST",
    body: form,
    headers: { "cf-connecting-ip": ip },
  });
}

describe("回数上限（sessionId）", () => {
  function stubUpstream(): void {
    vi.stubEnv("VOICE_TRANSCRIBE_MOCK", "");
    vi.stubEnv("OPENAI_API_KEY", "sk-test");
    vi.stubEnv("VOICE_TRANSCRIBE_LIMIT", "1");
    vi.stubEnv("VOICE_TRANSCRIBE_WINDOW_MINUTES", "60");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ text: "渋谷ホール" })),
    );
    vi.spyOn(console, "warn").mockImplementation(() => {});
  }

  it("同じ sessionId の 2 回目以降は回数を数えない", async () => {
    stubUpstream();

    const first = await postTranscription(
      segmentRequest("198.51.100.201", "session-same"),
    );
    const second = await postTranscription(
      segmentRequest("198.51.100.201", "session-same"),
    );
    // 同じ録音の続きは 429 にしない。
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);

    // 別の録音は 1 回ぶんとして数え、上限に当たる。
    const other = await postTranscription(
      segmentRequest("198.51.100.201", "session-other"),
    );
    expect(other.status).toBe(429);
  });

  it("sessionId が無ければ今までどおり毎回数える", async () => {
    stubUpstream();

    const first = await postTranscription(segmentRequest("198.51.100.202"));
    const second = await postTranscription(segmentRequest("198.51.100.202"));

    expect(first.status).toBe(200);
    expect(second.status).toBe(429);
  });
});

describe("自由文の送信（transcribeVoiceUtterance）", () => {
  const done =
    'event: done\ndata: {"text":"忘年会。12月5日です。","assignments":' +
    '[{"slotId":"title:0","text":"忘年会","patch":{"title":"忘年会"},"value":"忘年会"}],' +
    '"unassigned":[],"model":"text"}\n\n';

  it("text があるときは音声を付けず、その文字だけで割当を受ける", async () => {
    const fetchMock = vi.fn(async () => sseResponse(done));
    vi.stubGlobal("fetch", fetchMock);

    const result = await transcribeVoiceUtterance({
      text: "忘年会。12月5日です。",
      value: EMPTY_EVENT_FORM,
      scope: { showOrganizerName: false, includeOptional: false, touched: new Set() },
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(String(url)).toContain("/api/v1/voice/utterances");
    const form = init.body as FormData;
    expect(form.get("text")).toBe("忘年会。12月5日です。");
    // 同じ音声を二度文字起こししない。区間で全文が取れていれば音声は送らない。
    expect(form.get("audio")).toBeNull();
    expect(result.assignments[0].slotId).toBe("title:0");
    expect(result.model).toBe("text");
  });

  it("done の内訳を読み、知らない理由は捨てる", async () => {
    const withDiagnostics =
      'event: done\ndata: {"text":"忘年会。","assignments":[],"unassigned":[],' +
      '"model":"text","estimated":false,"diagnostics":' +
      '{"reason":"no-key","quotes":0,"accepted":0,"dropped":0,"deterministic":1,"chars":4}}\n\n';
    vi.stubGlobal("fetch", vi.fn(async () => sseResponse(withDiagnostics)));

    const result = await transcribeVoiceUtterance({
      text: "忘年会。",
      value: EMPTY_EVENT_FORM,
      scope: { showOrganizerName: false, includeOptional: false, touched: new Set() },
    });

    expect(result.estimated).toBe(false);
    expect(result.diagnostics).toEqual({
      reason: "no-key",
      quotes: 0,
      accepted: 0,
      dropped: 0,
      deterministic: 1,
      chars: 4,
    });

    // 理由が知らない値なら、計測に嘘を入れずに内訳ごと落とす。
    const unknown =
      'event: done\ndata: {"text":"忘年会。","assignments":[],"unassigned":[],' +
      '"model":"text","diagnostics":{"reason":"mystery","quotes":1}}\n\n';
    vi.stubGlobal("fetch", vi.fn(async () => sseResponse(unknown)));

    const second = await transcribeVoiceUtterance({
      text: "忘年会。",
      value: EMPTY_EVENT_FORM,
      scope: { showOrganizerName: false, includeOptional: false, touched: new Set() },
    });

    expect(second.diagnostics).toBeUndefined();
  });
});
