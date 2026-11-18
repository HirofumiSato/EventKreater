import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/v1/voice/utterances/route";
import {
  assignBatch,
  estimateBatchAssignments,
  mockBatchTranscript,
} from "@/modules/events/lib/voice/batch";
import { batchTargets, defaultVoiceMode } from "@/modules/events/lib/voice/batch-guide";
import { MAX_AUDIO_BYTES } from "@/modules/events/lib/voice/audio";
import { voiceFieldOrder } from "@/modules/events/lib/voice/fields";
import type { VoiceFieldScope } from "@/modules/events/lib/voice/types";
import {
  createPricePlanDraft,
  createScheduleDraft,
  EMPTY_EVENT_FORM,
  withGenderPricing,
  type EventFormValues,
} from "@/modules/events/types";

/** 2026 年 10 月 24 日（日本時間）を基準にする。相対日付のテストを固定するため。 */
const NOW = new Date("2026-10-24T09:00:00+09:00");

/** 自由文の見本。日付・時刻・会場・金額・定員が 1 文に混ざっている。 */
const NATURAL =
  "忘年会を12月5日の18時から20時に渋谷ホールで開きます。参加費は3000円、定員は30人です。";

function scope(overrides: Partial<VoiceFieldScope> = {}): VoiceFieldScope {
  return {
    showOrganizerName: false,
    includeOptional: true,
    touched: new Set(),
    ...overrides,
  };
}

function assign(text = NATURAL, value: EventFormValues = EMPTY_EVENT_FORM) {
  return assignBatch(text, { now: NOW, value, scope: scope() });
}

function bySlot(result: Awaited<ReturnType<typeof assignBatch>>) {
  return new Map(result.assignments.map((item) => [item.slotId, item]));
}

function llmResponse(assignments: { slotId: string; quote: string }[]): Response {
  return Response.json({
    choices: [{ message: { content: JSON.stringify({ assignments }) } }],
  });
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("LLM で原文から quote を抜き出す", () => {
  it("自然文 1 文から日付・開始・終了・会場・金額・定員が埋まる", async () => {
    vi.stubEnv("OPENAI_API_KEY", "sk-test");
    const fetchMock = vi.fn(async () =>
      llmResponse([
        { slotId: "title:0", quote: "忘年会" },
        { slotId: "scheduleDate:0", quote: "12月5日" },
        { slotId: "scheduleStart:0", quote: "18時から20時" },
        { slotId: "venueName:0", quote: "渋谷ホール" },
        { slotId: "planAmount:0", quote: "3000円" },
        { slotId: "capacity:0", quote: "30人" },
      ]),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await assign();
    const slots = bySlot(result);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    // batchTargets の順（イベント名 → 開催日 → 開始 → 金額 → 会場 → 定員）に並ぶ。
    expect(result.assignments.map((item) => item.slotId)).toEqual([
      "title:0",
      "scheduleDate:0",
      "scheduleStart:0",
      "planAmount:0",
      "venueName:0",
      "capacity:0",
    ]);

    expect(slots.get("title:0")?.value).toBe("忘年会");
    expect(slots.get("scheduleDate:0")?.patch.schedules?.[0].eventDate).toBe("2026-12-05");
    expect(slots.get("scheduleStart:0")?.patch.schedules?.[0]).toMatchObject({
      startTime: "18:00",
      endTime: "20:00",
    });
    // 開始が範囲で終了も読めたので、終了の行は二重に作らない。
    expect(slots.has("scheduleEnd:0")).toBe(false);
    expect(slots.get("planAmount:0")?.patch.pricePlans?.[0].amount).toBe("3000");
    expect(slots.get("venueName:0")?.patch).toEqual({ venueName: "渋谷ホール" });
    expect(slots.get("capacity:0")?.patch).toEqual({ capacity: 30 });
  });

  it("quote は前後の助詞・句読点を落としてから原文と照合する", async () => {
    vi.stubEnv("OPENAI_API_KEY", "sk-test");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        llmResponse([{ slotId: "scheduleDate:0", quote: "「12月5日に」" }]),
      ),
    );

    const result = await assign();

    const date = bySlot(result).get("scheduleDate:0");
    expect(date?.text).toBe("12月5日");
    expect(date?.patch.schedules?.[0].eventDate).toBe("2026-12-05");
  });

  it("原文に無い quote は捨てる", async () => {
    vi.stubEnv("OPENAI_API_KEY", "sk-test");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => llmResponse([{ slotId: "title:0", quote: "新年会" }])),
    );

    const result = await assign("よろしく、渋谷ホール");

    expect(result.assignments.map((item) => item.slotId)).toEqual(["venueName:0"]);
    expect(result.unassigned).toContain("よろしく");
  });

  it("parse が null を返す quote は捨てる", async () => {
    vi.stubEnv("OPENAI_API_KEY", "sk-test");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => llmResponse([{ slotId: "capacity:0", quote: "よろしく" }])),
    );

    const result = await assign("よろしく、渋谷ホール");

    expect(result.assignments.map((item) => item.slotId)).toEqual(["venueName:0"]);
  });

  it("存在しない slotId は捨てる", async () => {
    vi.stubEnv("OPENAI_API_KEY", "sk-test");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => llmResponse([{ slotId: "unknown:0", quote: "よろしく" }])),
    );

    const result = await assign("よろしく、渋谷ホール");

    expect(result.assignments.map((item) => item.slotId)).toEqual(["venueName:0"]);
  });

  it("同じ欄・同じ quote の重複は捨てる", async () => {
    vi.stubEnv("OPENAI_API_KEY", "sk-test");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        llmResponse([
          { slotId: "title:0", quote: "忘年会" },
          { slotId: "title:0", quote: "忘年会" },
          { slotId: "venueName:0", quote: "忘年会" },
        ]),
      ),
    );

    const result = await assign();

    // 同じ欄は 1 回だけ。同じ quote を別の欄にも使わない。
    const titles = result.assignments.filter((item) => item.slotId === "title:0");
    expect(titles).toHaveLength(1);
    expect(titles[0].text).toBe("忘年会");
    expect(new Set(result.assignments.map((item) => item.text)).size).toBe(
      result.assignments.length,
    );
  });

  it("LLM が失敗したら決定的な割当だけを返す", async () => {
    vi.stubEnv("OPENAI_API_KEY", "sk-test");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({ error: { code: "server_error" } }, { status: 500 }),
      ),
    );
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = await assign("よろしく、渋谷ホール");

    expect(result.assignments.map((item) => item.slotId)).toEqual(["venueName:0"]);
    expect(result.unassigned).toContain("よろしく");
    // 上流の本文は出さず、status と code だけを残す。
    expect(warn).toHaveBeenCalledWith(
      "[voice] batch assignment failed: status=500 code=server_error",
    );
  });

  it("VOICE_BATCH_LLM=0 なら fetch を呼ばない", async () => {
    vi.stubEnv("OPENAI_API_KEY", "sk-test");
    vi.stubEnv("VOICE_BATCH_LLM", "0");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = await assign("よろしく、渋谷ホール");

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.assignments.map((item) => item.slotId)).toEqual(["venueName:0"]);
    expect(result.unassigned).toContain("よろしく");
  });

  it("json_schema で 400 を返したら json_object で 1 回だけ再試行する", async () => {
    vi.stubEnv("OPENAI_API_KEY", "sk-test");
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({ error: { code: "unsupported_value" } }, { status: 400 }),
      )
      .mockResolvedValueOnce(llmResponse([{ slotId: "title:0", quote: "よろしく" }]));
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = await assign("よろしく、渋谷ホール");

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const second = JSON.parse(String(fetchMock.mock.calls[1][1]?.body)) as {
      response_format: { type: string };
    };
    expect(second.response_format).toEqual({ type: "json_object" });
    expect(result.assignments.some((item) => item.slotId === "title:0")).toBe(true);
  });

  it("全文が空なら LLM を呼ばない", async () => {
    vi.stubEnv("OPENAI_API_KEY", "sk-test");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = await estimateBatchAssignments(
      voiceFieldOrder(EMPTY_EVENT_FORM, scope()),
      "   ",
      EMPTY_EVENT_FORM,
      NOW,
      scope(),
    );

    expect(result.assignments).toEqual([]);
    expect(result.diagnostics.reason).toBe("no-input");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("割当の内訳（diagnostics）", () => {
  it("全件通ったら ok で、quotes と accepted が同じになる", async () => {
    vi.stubEnv("OPENAI_API_KEY", "sk-test");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        llmResponse([
          { slotId: "title:0", quote: "忘年会" },
          { slotId: "venueName:0", quote: "渋谷ホール" },
        ]),
      ),
    );

    const result = await assign();

    expect(result.diagnostics).toMatchObject({
      reason: "ok",
      quotes: 2,
      accepted: 2,
      dropped: 0,
    });
    expect(result.estimated).toBe(true);
    expect(result.diagnostics.chars).toBe(NATURAL.trim().length);
  });

  it("検証で落ちた件数を dropped に数える", async () => {
    vi.stubEnv("OPENAI_API_KEY", "sk-test");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        llmResponse([
          { slotId: "title:0", quote: "忘年会" },
          { slotId: "title:0", quote: "忘年会" },
          { slotId: "unknown:0", quote: "渋谷ホール" },
        ]),
      ),
    );

    const result = await assign();

    expect(result.diagnostics).toMatchObject({
      reason: "ok",
      quotes: 3,
      accepted: 1,
      dropped: 2,
    });
  });

  it("1 件も通らなければ empty とし、決定的な割当の件数を残す", async () => {
    vi.stubEnv("OPENAI_API_KEY", "sk-test");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => llmResponse([{ slotId: "title:0", quote: "新年会" }])),
    );

    const result = await assign("よろしく、渋谷ホール");

    expect(result.diagnostics).toMatchObject({
      reason: "empty",
      quotes: 1,
      accepted: 0,
      dropped: 1,
    });
    expect(result.diagnostics.deterministic).toBeGreaterThan(0);
    expect(result.estimated).toBe(false);
  });

  it("モックは mock、鍵が無ければ no-key を残す", async () => {
    vi.stubEnv("VOICE_TRANSCRIBE_MOCK", "1");
    vi.stubEnv("OPENAI_API_KEY", "");
    expect((await assign()).diagnostics.reason).toBe("mock");

    vi.stubEnv("VOICE_TRANSCRIBE_MOCK", "");
    expect((await assign()).diagnostics.reason).toBe("no-key");
  });

  it("VOICE_BATCH_LLM=0 は skipped、上流が 500 なら http-error", async () => {
    vi.stubEnv("OPENAI_API_KEY", "sk-test");
    vi.stubEnv("VOICE_BATCH_LLM", "0");
    expect((await assign()).diagnostics.reason).toBe("skipped");

    vi.stubEnv("VOICE_BATCH_LLM", "");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({ error: { code: "server_error" } }, { status: 500 }),
      ),
    );
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect((await assign()).diagnostics.reason).toBe("http-error");
  });

  it("本文と quote はログに出さず、件数だけを 1 行で出す", async () => {
    vi.stubEnv("OPENAI_API_KEY", "sk-test");
    vi.stubEnv("NODE_ENV", "development");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => llmResponse([{ slotId: "title:0", quote: "忘年会" }])),
    );
    const info = vi.spyOn(console, "info").mockImplementation(() => {});

    await assign();

    expect(info).toHaveBeenCalledTimes(1);
    const line = String(info.mock.calls[0][0]);
    expect(line).toContain("llm=ok");
    expect(line).toContain("quotes=1");
    expect(line).toContain("accepted=1");
    expect(line).not.toContain("忘年会");
  });
});

describe("自由文のモック", () => {
  it("「、」区切りの列挙ではなく、自然な 1 文を返す", () => {
    vi.stubEnv("VOICE_TRANSCRIBE_MOCK", "1");
    const text = mockBatchTranscript(EMPTY_EVENT_FORM, scope());

    expect(text).toBe(
      "忘年会。12月5日に開きます。18時から20時、渋谷ホールで行います。" +
        "参加費は3000円、1ドリンク付です。" +
        "郵便番号は1500001、住所は東京都渋谷区神宮前1-2-3、○○ビル3階です。" +
        "定員は30人、申し込み期限は12月1日23時59分、雨天決行です。",
    );
  });

  it("入力済みの欄の例を含まない", () => {
    vi.stubEnv("VOICE_TRANSCRIBE_MOCK", "1");
    const text = mockBatchTranscript(
      { ...EMPTY_EVENT_FORM, title: "秋の音楽会" },
      scope(),
    );

    expect(text).not.toContain("忘年会");
    expect(text).toContain("12月5日");
  });
});

describe("自由文で埋める対象", () => {
  it("入力済みの欄は対象にしない", () => {
    const value: EventFormValues = {
      ...EMPTY_EVENT_FORM,
      title: "秋の音楽会",
      venueName: "渋谷ホール",
    };

    const ids = batchTargets(value, scope()).map((slot) => slot.id);

    expect(ids).not.toContain("title:0");
    expect(ids).not.toContain("venueName:0");
    expect(ids).toContain("scheduleDate:0");
    expect(ids).toContain("capacity:0");
  });

  it("任意欄を外したスコープでは必須の空欄だけになる", () => {
    const ids = batchTargets(
      EMPTY_EVENT_FORM,
      scope({ includeOptional: false }),
    ).map((slot) => slot.id);

    expect(ids).toContain("title:0");
    expect(ids).not.toContain("capacity:0");
    expect(ids).not.toContain("rsvpDeadline:0");
  });

  it("空欄が 3 つ以上なら自由文を既定にする", () => {
    const targets = batchTargets(EMPTY_EVENT_FORM, scope());

    expect(defaultVoiceMode(targets.slice(0, 2), EMPTY_EVENT_FORM)).toBe("single");
    expect(defaultVoiceMode(targets.slice(0, 3), EMPTY_EVENT_FORM)).toBe("batch");
  });

  it("日程が 2 件あると、1 つずつを既定にする", () => {
    const value: EventFormValues = {
      ...EMPTY_EVENT_FORM,
      schedules: [
        createScheduleDraft({ key: "schedule-1" }),
        createScheduleDraft({ key: "schedule-2" }),
      ],
    };

    expect(defaultVoiceMode(batchTargets(value, scope()), value)).toBe("single");
  });

  it("男女別の料金があると、1 つずつを既定にする", () => {
    const value: EventFormValues = {
      ...EMPTY_EVENT_FORM,
      pricePlans: withGenderPricing(EMPTY_EVENT_FORM.pricePlans),
    };

    expect(value.pricePlans.some((plan) => plan.audience !== "ANY")).toBe(true);
    expect(defaultVoiceMode(batchTargets(value, scope()), value)).toBe("single");
  });

  it("料金プランが 2 組あると、1 つずつを既定にする", () => {
    const value: EventFormValues = {
      ...EMPTY_EVENT_FORM,
      pricePlans: [
        createPricePlanDraft({ key: "plan-1" }),
        createPricePlanDraft({ key: "plan-2" }),
      ],
    };

    expect(defaultVoiceMode(batchTargets(value, scope()), value)).toBe("single");
  });
});

/** 1 件ぶんのリクエスト。`text` があるときは音声を省ける。 */
function request(
  options: {
    audioBytes?: number;
    withAudio?: boolean;
    text?: string;
    value?: unknown;
    ip?: string;
  } = {},
): NextRequest {
  const form = new FormData();
  if (options.withAudio !== false) {
    const bytes = new Uint8Array(options.audioBytes ?? 3).fill(1);
    form.append("audio", new File([bytes], "voice.webm", { type: "audio/webm" }));
  }
  if (options.text !== undefined) form.append("text", options.text);
  const value = options.value === undefined ? EMPTY_EVENT_FORM : options.value;
  form.append("value", JSON.stringify(value));
  return new NextRequest("http://localhost:3012/api/v1/voice/utterances", {
    method: "POST",
    body: form,
    headers: { "cf-connecting-ip": options.ip ?? "203.0.113.1" },
  });
}

/** SSE の本文を、`event` と `data` の組に分ける。 */
async function readEvents(response: Response): Promise<{ event: string; data: any }[]> {
  const body = await response.text();
  return body
    .split("\n\n")
    .filter((chunk) => chunk.trim().length > 0)
    .map((chunk) => {
      const lines = chunk.split("\n");
      const event = lines.find((line) => line.startsWith("event: "))?.slice(7) ?? "";
      const data = lines.find((line) => line.startsWith("data: "))?.slice(6) ?? "null";
      return { event, data: JSON.parse(data) };
    });
}

describe("POST /api/v1/voice/utterances", () => {
  it("モック有効なら 200 で自然文と割当を返す", async () => {
    vi.stubEnv("VOICE_TRANSCRIBE_MOCK", "1");
    vi.stubEnv("OPENAI_API_KEY", "");

    const response = await POST(request());

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    const events = await readEvents(response);
    const done = events.find((item) => item.event === "done");
    const body = done?.data as {
      text: string;
      assignments: { slotId: string; text: string; value: unknown; patch: unknown }[];
      unassigned: string[];
      model: string;
    };
    expect(body.model).toBe("mock");
    expect(body.text).toContain("忘年会。12月5日に開きます。");
    expect(body.assignments.length).toBeGreaterThan(0);
    expect(body.assignments[0]).toHaveProperty("patch");
    // モック（LLM 無し）でも、決定的な割当で自然文から主要な欄が埋まる。
    expect(body.assignments.map((item) => item.slotId)).toEqual(
      expect.arrayContaining([
        "title:0",
        "scheduleDate:0",
        "scheduleStart:0",
        "venueName:0",
        "planAmount:0",
        "capacity:0",
      ]),
    );
    expect(Array.isArray(body.unassigned)).toBe(true);
  });

  it("cell を返さず、delta と done だけを返す", async () => {
    vi.stubEnv("VOICE_TRANSCRIBE_MOCK", "1");
    vi.stubEnv("OPENAI_API_KEY", "");

    const events = await readEvents(await POST(request()));

    expect(events.every((item) => item.event === "delta" || item.event === "done")).toBe(
      true,
    );
    expect(events.findIndex((item) => item.event === "delta")).toBeLessThan(
      events.findIndex((item) => item.event === "done"),
    );
  });

  it("text があれば文字起こしを呼ばず、done だけを返す", async () => {
    vi.stubEnv("VOICE_TRANSCRIBE_MOCK", "");
    vi.stubEnv("OPENAI_API_KEY", "sk-test");
    vi.stubEnv("VOICE_BATCH_LLM", "0");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(
      request({ withAudio: false, text: "12月5日に渋谷ホールで開きます。" }),
    );

    expect(response.status).toBe(200);
    expect(fetchMock).not.toHaveBeenCalled();
    const events = await readEvents(response);
    expect(events.some((item) => item.event === "delta")).toBe(false);
    const body = events.find((item) => item.event === "done")?.data as {
      text: string;
      assignments: { slotId: string }[];
      estimated: boolean;
      diagnostics: { reason: string; deterministic: number; chars: number };
    };
    expect(body.text).toBe("12月5日に渋谷ホールで開きます。");
    expect(body.assignments.map((item) => item.slotId)).toContain("scheduleDate:0");
    // 古い画面が無視できる形で、内訳を done に添える。
    expect(body.estimated).toBe(false);
    expect(body.diagnostics.reason).toBe("skipped");
    expect(body.diagnostics.deterministic).toBeGreaterThan(0);
    expect(body.diagnostics.chars).toBe("12月5日に渋谷ホールで開きます。".length);
  });

  it("text が 2000 文字を超えたら 400", async () => {
    vi.stubEnv("VOICE_TRANSCRIBE_MOCK", "1");

    const response = await POST(
      request({ withAudio: false, text: "あ".repeat(2001) }),
    );

    expect(response.status).toBe(400);
    const body = (await response.json()) as { detail: string };
    expect(body.detail).toContain("2000");
  });

  it("空の text は文字起こしへ落とす（audio があれば 400 にしない）", async () => {
    vi.stubEnv("VOICE_TRANSCRIBE_MOCK", "1");
    vi.stubEnv("OPENAI_API_KEY", "");

    const response = await POST(request({ text: "   " }));

    expect(response.status).toBe(200);
    const events = await readEvents(response);
    expect(events.some((item) => item.event === "done")).toBe(true);
  });

  it("モックは回数の上限を数えない", async () => {
    vi.stubEnv("VOICE_TRANSCRIBE_MOCK", "1");
    vi.stubEnv("OPENAI_API_KEY", "");
    vi.stubEnv("VOICE_TRANSCRIBE_LIMIT", "1");

    for (let index = 0; index < 3; index += 1) {
      const response = await POST(request({ ip: "198.51.100.9" }));
      expect(response.status).toBe(200);
    }
  });

  it("控えのモデルへ落ちたら、実際に使ったモデル名を返す", async () => {
    vi.stubEnv("VOICE_TRANSCRIBE_MOCK", "");
    vi.stubEnv("OPENAI_API_KEY", "sk-test");
    vi.stubEnv("VOICE_TRANSCRIBE_MODEL", "gpt-transcribe");
    vi.stubEnv("VOICE_TRANSCRIBE_FALLBACK_MODEL", "gpt-4o-mini-transcribe");
    vi.stubEnv("VOICE_BATCH_LLM", "0");

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json(
          { error: { code: "model_not_found", message: "model not found" } },
          { status: 400 },
        ),
      )
      .mockResolvedValueOnce(Response.json({ text: "渋谷ホール" }));
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "warn").mockImplementation(() => {});

    const response = await POST(request({ ip: "198.51.100.10" }));

    expect(response.status).toBe(200);
    const events = await readEvents(response);
    const body = events.find((item) => item.event === "done")?.data as {
      text: string;
      model: string;
    };
    expect(body.text).toBe("渋谷ホール");
    expect(body.model).toBe("gpt-4o-mini-transcribe");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("audio も text も無ければ 400", async () => {
    vi.stubEnv("VOICE_TRANSCRIBE_MOCK", "1");

    const response = await POST(request({ withAudio: false }));

    expect(response.status).toBe(400);
    const body = (await response.json()) as { detail: string };
    expect(body.detail).toContain("音声が空です");
  });

  it("5MB を超えたら 413", async () => {
    vi.stubEnv("VOICE_TRANSCRIBE_MOCK", "1");

    const response = await POST(request({ audioBytes: MAX_AUDIO_BYTES + 1 }));

    expect(response.status).toBe(413);
  });

  it("value が無ければ 400", async () => {
    vi.stubEnv("VOICE_TRANSCRIBE_MOCK", "1");

    const response = await POST(request({ value: null }));

    expect(response.status).toBe(400);
    const body = (await response.json()) as { detail: string };
    expect(body.detail).toContain("フォームの値");
  });
});
