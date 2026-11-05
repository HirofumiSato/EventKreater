/**
 * Server-Sent Events（SSE）の受信を、ブラウザにも Node にも依存しない形で扱う。
 *
 * 音声認識の中継は `text/event-stream` で届く。ストリームは 1 イベントが必ずしも
 * 1 チャンクに収まらず、`data: {...}` の途中、`\r\n` の途中、UTF-8 の 1 文字の途中で
 * 切れることがある。チャンクをそのまま JSON として読むと、境界に当たったときだけ
 * 失敗する（再現しにくい）不具合になるため、行とイベントの組み立てはここで行う。
 *
 * このファイルは DOM・Next・fetch を import しない。`ReadableStream` を読む薄い
 * ヘルパーだけを置き、解釈は純粋な関数に保つ。
 */

/** 受信した 1 イベント。`event:` が無ければ `event` は `"message"`。 */
export interface SseEvent {
  event: string;
  data: string;
}

/** チャンクを跨いでイベントを組み立てるパーサ。 */
export interface SseParser {
  /** 受け取った文字列から、確定したイベントだけを返す。途中の行は内部に残す。 */
  push(chunk: string): SseEvent[];
  /** ストリームの終わりに呼ぶ。空行で終わっていない最後のイベントを返す。 */
  flush(): SseEvent[];
}

/**
 * SSE のパーサを作る。
 *
 * 状態は「まだ改行が来ていない行」と「組み立て中のイベント」の 2 つだけ。
 * `push` は何度に分けて呼んでもよい（チャンク境界を意識するのは呼び出し側ではなくここ）。
 */
export function createSseParser(): SseParser {
  /** 改行がまだ来ていない行。チャンクの切れ目はここに溜める。 */
  let pendingLine = "";
  /** `event:` の値。未指定は null で、確定時に `"message"` にする。 */
  let eventName: string | null = null;
  /** `data:` の行。空行が来るまで溜め、`\n` で連結する。 */
  let dataLines: string[] = [];

  /** 1 行を処理し、空行ならイベントを確定して返す。 */
  function handleLine(rawLine: string): SseEvent | null {
    // `\r\n` の `\r` は行の末尾に付く。値としては要らない。
    const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;

    // 空行はイベントの区切り。data が空ならイベントとしては出さない。
    if (line === "") {
      const data = dataLines.join("\n");
      const event = data.length > 0 ? { event: eventName || "message", data } : null;
      eventName = null;
      dataLines = [];
      return event;
    }

    // `:` で始まる行はコメント（keep-alive など）。イベントには含めない。
    if (line.startsWith(":")) return null;

    const colon = line.indexOf(":");
    const field = colon === -1 ? line : line.slice(0, colon);
    let value = colon === -1 ? "" : line.slice(colon + 1);
    // 仕様どおり、コロンの直後の半角空白を 1 つだけ落とす。
    if (value.startsWith(" ")) value = value.slice(1);

    if (field === "event") {
      eventName = value;
    } else if (field === "data") {
      dataLines.push(value);
    }
    // `id:` `retry:` と知らない field は使わない。ここでは読み飛ばす。
    return null;
  }

  return {
    push(chunk: string): SseEvent[] {
      pendingLine += chunk;
      const events: SseEvent[] = [];
      let start = 0;
      for (;;) {
        const newline = pendingLine.indexOf("\n", start);
        if (newline === -1) break;
        const event = handleLine(pendingLine.slice(start, newline));
        if (event) events.push(event);
        start = newline + 1;
      }
      pendingLine = pendingLine.slice(start);
      return events;
    },

    flush(): SseEvent[] {
      const events: SseEvent[] = [];

      // 最後の改行より後ろに残った行を処理する（改行なしで終わった場合）。
      if (pendingLine.length > 0) {
        const line = pendingLine;
        pendingLine = "";
        const event = handleLine(line);
        if (event) events.push(event);
      }

      // 空行が来ないまま終わったイベントを確定する。
      // ただし data が無い（コメントだけ、event だけ）なら返さない。
      const data = dataLines.join("\n");
      if (data.length > 0) {
        events.push({ event: eventName || "message", data });
      }
      eventName = null;
      dataLines = [];
      return events;
    },
  };
}

/** 自前の中継プロトコル。`event:` の名前と `data:` の JSON の形を対応させる。 */
export type VoiceStreamEvent =
  | { type: "delta"; text: string }
  | { type: "done"; text: string }
  | { type: "error"; error: string; detail: string };

/**
 * 1 イベントを自前の形へ読む。知らないイベント名・壊れた JSON・形の違う JSON は
 * null にする（呼び出し側は「読めなかった」として捨てる）。
 */
export function parseVoiceStreamEvent(event: SseEvent): VoiceStreamEvent | null {
  let payload: unknown;
  try {
    payload = JSON.parse(event.data);
  } catch {
    // 途中で切れた JSON は、次のイベントが来れば直る。ここでは捨てるだけ。
    return null;
  }
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) return null;

  const record = payload as Record<string, unknown>;
  switch (event.event) {
    case "delta":
      return typeof record.text === "string" ? { type: "delta", text: record.text } : null;
    case "done":
      return typeof record.text === "string" ? { type: "done", text: record.text } : null;
    case "error":
      if (typeof record.error !== "string") return null;
      return {
        type: "error",
        error: record.error,
        detail: typeof record.detail === "string" ? record.detail : "",
      };
    default:
      return null;
  }
}

export interface ReadSseStreamOptions {
  /** 打ち切りたいときの signal。中断したら読むのをやめる。 */
  signal?: AbortSignal;
}

/**
 * `ReadableStream<Uint8Array>` を読み、確定したイベントを順に渡す薄いヘルパー。
 *
 * TextDecoder を `stream: true` で使うので、UTF-8 の 1 文字がチャンクの境目で
 * 切れても文字化けしない。解釈（JSON を読むなど）は呼び出し側に任せる。
 */
export async function readSseStream(
  stream: ReadableStream<Uint8Array>,
  onEvent: (event: SseEvent) => void,
  options: ReadSseStreamOptions = {},
): Promise<void> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  const parser = createSseParser();

  // 中断されたら read を終わらせる。read は signal を見ないため、cancel で起こす。
  const cancel = () => {
    void reader.cancel().catch(() => undefined);
  };
  options.signal?.addEventListener("abort", cancel, { once: true });

  try {
    for (;;) {
      if (options.signal?.aborted) break;
      const { done, value } = await reader.read();
      if (done) break;
      for (const event of parser.push(decoder.decode(value, { stream: true }))) {
        onEvent(event);
      }
    }
    // 最後に残った 1 文字（不完全な UTF-8）を流し切る。
    for (const event of parser.push(decoder.decode())) onEvent(event);
    for (const event of parser.flush()) onEvent(event);
  } finally {
    options.signal?.removeEventListener("abort", cancel);
    reader.releaseLock();
  }
}
