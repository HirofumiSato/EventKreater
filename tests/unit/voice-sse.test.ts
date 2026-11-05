import { describe, expect, it } from "vitest";
import {
  createSseParser,
  parseVoiceStreamEvent,
  readSseStream,
  type SseEvent,
} from "@/modules/events/lib/voice/sse";

/** チャンク列を順に流し、確定したイベントだけを集める。 */
function collect(chunks: readonly string[]): SseEvent[] {
  const parser = createSseParser();
  const events: SseEvent[] = [];
  for (const chunk of chunks) events.push(...parser.push(chunk));
  return events;
}

/** バイト列のチャンクを流すストリーム。 */
function streamOf(chunks: readonly Uint8Array[]): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  });
}

describe("SSE の組み立て", () => {
  it("1 つのチャンクに 1 イベントが入っていれば、そのまま返す", () => {
    expect(collect(['event: delta\ndata: {"text":"こんにちは"}\n\n'])).toEqual([
      { event: "delta", data: '{"text":"こんにちは"}' },
    ]);
  });

  it("event 行が無ければ message になる", () => {
    expect(collect(["data: hello\n\n"])).toEqual([{ event: "message", data: "hello" }]);
  });

  it("空行が来るまでイベントを返さない", () => {
    const parser = createSseParser();
    expect(parser.push("event: delta\ndata: 途中\n")).toEqual([]);
    expect(parser.push("\n")).toEqual([{ event: "delta", data: "途中" }]);
  });

  it("チャンクの境目でイベントが切れても組み立てる", () => {
    // 行の途中、data の途中、event 名の途中で切る。
    expect(collect(["event: del", "ta\ndata: 12", "3\n\n"])).toEqual([
      { event: "delta", data: "123" },
    ]);
  });

  it("data が複数行なら改行で連結する", () => {
    expect(collect(["data: 1行目\ndata: 2行目\ndata: 3行目\n\n"])).toEqual([
      { event: "message", data: "1行目\n2行目\n3行目" },
    ]);
  });

  it("コメント行はイベントに含めない", () => {
    expect(collect([": keep-alive\nevent: delta\ndata: x\n\n"])).toEqual([
      { event: "delta", data: "x" },
    ]);
    // コメントだけの塊は、data が無いのでイベントにならない。
    expect(collect([": ping\n\n"])).toEqual([]);
  });

  it("\\r\\n の改行も受ける", () => {
    expect(collect(['event: done\r\ndata: {"text":"おわり"}\r\n\r\n'])).toEqual([
      { event: "done", data: '{"text":"おわり"}' },
    ]);
  });

  it("\\r\\n がチャンクの境目で切れても空行と誤認しない", () => {
    // 2 チャンク目の末尾が "\r\n"、3 チャンク目が "\r\n"。
    // "\r" を単独の改行として扱うと、2 チャンク目で空行が来たことになり、
    // data が "a" だけのイベントが先に確定してしまう。
    expect(collect(["data: a\r", "\ndata: b\r\n", "\r\n"])).toEqual([
      { event: "message", data: "a\nb" },
    ]);
  });

  it("1 つのチャンクに複数イベントが入っていれば順に返す", () => {
    expect(collect(["data: 1\n\ndata: 2\n\n"])).toEqual([
      { event: "message", data: "1" },
      { event: "message", data: "2" },
    ]);
  });

  it("data の値にあるコロンはそのまま残す", () => {
    expect(collect(['data: {"text":"12:30"}\n\n'])).toEqual([
      { event: "message", data: '{"text":"12:30"}' },
    ]);
  });

  it("id や retry など知らない field は無視する", () => {
    expect(collect(["id: 7\nretry: 100\ndata: x\n\n"])).toEqual([
      { event: "message", data: "x" },
    ]);
  });

  it("コロンの直後の半角空白は 1 つだけ落とす", () => {
    expect(collect(["data:  2つ目\n\n"])).toEqual([{ event: "message", data: " 2つ目" }]);
    expect(collect(["data:x\n\n"])).toEqual([{ event: "message", data: "x" }]);
  });
});

describe("ストリームの終わり", () => {
  it("空行が無いまま終わったら flush が最後のイベントを返す", () => {
    const parser = createSseParser();
    expect(parser.push("event: done\ndata: 20")).toEqual([]);
    expect(parser.flush()).toEqual([{ event: "done", data: "20" }]);
  });

  it("data が無ければ flush は何も返さない", () => {
    const parser = createSseParser();
    expect(parser.push("event: done\n")).toEqual([]);
    expect(parser.flush()).toEqual([]);
  });

  it("flush のあとに次のイベントを組み立て直せる", () => {
    const parser = createSseParser();
    parser.push("data: 1");
    expect(parser.flush()).toEqual([{ event: "message", data: "1" }]);
    expect(parser.push("data: 2\n\n")).toEqual([{ event: "message", data: "2" }]);
  });

  it("flush を 2 回呼んでも同じイベントを繰り返さない", () => {
    const parser = createSseParser();
    parser.push("data: 1");
    expect(parser.flush()).toEqual([{ event: "message", data: "1" }]);
    expect(parser.flush()).toEqual([]);
  });

  it("改行なしで終わった複数行の data も flush で連結する", () => {
    const parser = createSseParser();
    parser.push("event: done\ndata: 1\ndata: 2");
    expect(parser.flush()).toEqual([{ event: "done", data: "1\n2" }]);
  });
});

describe("自前イベントの解釈", () => {
  it("delta を読む", () => {
    expect(parseVoiceStreamEvent({ event: "delta", data: '{"text":"こん"}' })).toEqual({
      type: "delta",
      text: "こん",
    });
  });

  it("done を読む", () => {
    expect(parseVoiceStreamEvent({ event: "done", data: '{"text":"こんにちは"}' })).toEqual({
      type: "done",
      text: "こんにちは",
    });
  });

  it("error を読む", () => {
    expect(
      parseVoiceStreamEvent({
        event: "error",
        data: '{"error":"TRANSCRIBE_FAILED","detail":"もう一度お試しください"}',
      }),
    ).toEqual({
      type: "error",
      error: "TRANSCRIBE_FAILED",
      detail: "もう一度お試しください",
    });
  });

  it("error の detail が無ければ空文字にする", () => {
    expect(
      parseVoiceStreamEvent({ event: "error", data: '{"error":"TRANSCRIBE_FAILED"}' }),
    ).toEqual({ type: "error", error: "TRANSCRIBE_FAILED", detail: "" });
  });

  it("壊れた JSON は null", () => {
    expect(parseVoiceStreamEvent({ event: "delta", data: '{"text":"途中' })).toBeNull();
    expect(parseVoiceStreamEvent({ event: "done", data: "" })).toBeNull();
  });

  it("JSON でも形が違えば null", () => {
    expect(parseVoiceStreamEvent({ event: "delta", data: '{"text":1}' })).toBeNull();
    expect(parseVoiceStreamEvent({ event: "delta", data: "[1,2]" })).toBeNull();
    expect(parseVoiceStreamEvent({ event: "delta", data: "null" })).toBeNull();
    expect(parseVoiceStreamEvent({ event: "delta", data: '"text"' })).toBeNull();
    expect(parseVoiceStreamEvent({ event: "error", data: '{"detail":"x"}' })).toBeNull();
  });

  it("知らないイベント名は null", () => {
    expect(parseVoiceStreamEvent({ event: "message", data: '{"text":"こん"}' })).toBeNull();
    expect(parseVoiceStreamEvent({ event: "heartbeat", data: "{}" })).toBeNull();
  });
});

describe("バイト列のストリームを読む", () => {
  it("UTF-8 の 1 文字がチャンクの境目で切れても文字化けしない", async () => {
    const text = 'event: delta\ndata: {"text":"こんにちは"}\n\n';
    const bytes = new TextEncoder().encode(text);
    // 1 バイトずつ流す。日本語の途中で必ず切れる。
    const chunks = Array.from(bytes, (byte) => new Uint8Array([byte]));

    const events: SseEvent[] = [];
    await readSseStream(streamOf(chunks), (event) => events.push(event));

    expect(events).toEqual([{ event: "delta", data: '{"text":"こんにちは"}' }]);
  });

  it("空行なしで終わったイベントも読む", async () => {
    const bytes = new TextEncoder().encode('event: done\ndata: {"text":"おわり"}');
    const events: SseEvent[] = [];
    await readSseStream(streamOf([bytes]), (event) => events.push(event));
    expect(events).toEqual([{ event: "done", data: '{"text":"おわり"}' }]);
  });

  it("中断済みの signal なら 1 度も読まない", async () => {
    let reads = 0;
    const stream = new ReadableStream<Uint8Array>(
      {
        pull(controller) {
          reads += 1;
          controller.enqueue(new TextEncoder().encode("data: x\n\n"));
          controller.close();
        },
      },
      // 既定の highWaterMark だと、読む前から供給側が 1 回動いてしまう。
      { highWaterMark: 0 },
    );
    const controller = new AbortController();
    controller.abort();

    const events: SseEvent[] = [];
    await readSseStream(stream, (event) => events.push(event), { signal: controller.signal });

    expect(reads).toBe(0);
    expect(events).toEqual([]);
  });
});
