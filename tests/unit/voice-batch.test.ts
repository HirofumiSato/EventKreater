import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/v1/voice/utterances/route";
import { assignBatch, estimateBatchAssignments, mockBatchTranscript } from "@/modules/events/lib/voice/batch";
import {
  batchExampleSentence,
  batchPlan,
  batchTargets,
  defaultVoiceMode,
} from "@/modules/events/lib/voice/batch-guide";
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

function scope(overrides: Partial<VoiceFieldScope> = {}): VoiceFieldScope {
  return {
    showOrganizerName: false,
    includeOptional: true,
    touched: new Set(),
    ...overrides,
  };
}

/** 決定的には会場だけが埋まり、「よろしく」が未割当に残る文。 */
const TEXT = "よろしく、渋谷ホール";

function assign(
  text = TEXT,
  value: EventFormValues = EMPTY_EVENT_FORM,
) {
  return assignBatch(text, { now: NOW, value, scope: scope() });
}

function llmResponse(assignments: { slotId: string; clause: string }[]): Response {
  return Response.json({
    choices: [{ message: { content: JSON.stringify({ assignments }) } }],
  });
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("LLM で節の割当を補う", () => {
  it("返ってきた slotId と節を採用し、patch は parse の戻り値と一致する", async () => {
    vi.stubEnv("OPENAI_API_KEY", "sk-test");
    const fetchMock = vi.fn(async () =>
      llmResponse([{ slotId: "title:0", clause: "よろしく" }]),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await assign();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const title = result.assignments.find((item) => item.slotId === "title:0");
    expect(title?.text).toBe("よろしく");
    expect(title?.value).toBe("よろしく");

    const slot = voiceFieldOrder(EMPTY_EVENT_FORM, scope()).find(
      (item) => item.id === "title:0",
    );
    expect(title?.patch).toEqual(
      slot?.field.parse("よろしく", { now: NOW, value: EMPTY_EVENT_FORM, row: 0 }),
    );
    expect(result.unassigned).toEqual([]);
  });

  it("存在しない slotId は捨てる", async () => {
    vi.stubEnv("OPENAI_API_KEY", "sk-test");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => llmResponse([{ slotId: "unknown:0", clause: "よろしく" }])),
    );

    const result = await assign();

    expect(result.assignments.map((item) => item.slotId)).toEqual(["venueName:0"]);
    expect(result.unassigned).toEqual(["よろしく"]);
  });

  it("未割当でない節は捨てる", async () => {
    vi.stubEnv("OPENAI_API_KEY", "sk-test");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => llmResponse([{ slotId: "title:0", clause: "渋谷ホール" }])),
    );

    const result = await assign();

    expect(result.assignments.map((item) => item.slotId)).toEqual(["venueName:0"]);
    expect(result.unassigned).toEqual(["よろしく"]);
  });

  it("parse が null を返す節は捨てる", async () => {
    vi.stubEnv("OPENAI_API_KEY", "sk-test");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => llmResponse([{ slotId: "capacity:0", clause: "よろしく" }])),
    );

    const result = await assign();

    expect(result.assignments.map((item) => item.slotId)).toEqual(["venueName:0"]);
    expect(result.unassigned).toEqual(["よろしく"]);
  });

  it("VOICE_BATCH_LLM=0 なら fetch を呼ばない", async () => {
    vi.stubEnv("OPENAI_API_KEY", "sk-test");
    vi.stubEnv("VOICE_BATCH_LLM", "0");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = await assign();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.assignments.map((item) => item.slotId)).toEqual(["venueName:0"]);
    expect(result.unassigned).toEqual(["よろしく"]);
  });

  it("上流が 500 でも決定的な割当は返る", async () => {
    vi.stubEnv("OPENAI_API_KEY", "sk-test");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({ error: { code: "server_error" } }, { status: 500 }),
      ),
    );
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = await assign();

    expect(result.assignments.map((item) => item.slotId)).toEqual(["venueName:0"]);
    expect(result.unassigned).toEqual(["よろしく"]);
    // 上流の本文は出さず、status と code だけを残す。
    expect(warn).toHaveBeenCalledWith(
      "[voice] batch assignment failed: status=500 code=server_error",
    );
  });

  it("json_schema で 400 を返したら json_object で 1 回だけ再試行する", async () => {
    vi.stubEnv("OPENAI_API_KEY", "sk-test");
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({ error: { code: "unsupported_value" } }, { status: 400 }),
      )
      .mockResolvedValueOnce(llmResponse([{ slotId: "title:0", clause: "よろしく" }]));
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = await assign();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const second = JSON.parse(String(fetchMock.mock.calls[1][1]?.body)) as {
      response_format: { type: string };
    };
    expect(second.response_format).toEqual({ type: "json_object" });
    expect(result.assignments.some((item) => item.slotId === "title:0")).toBe(true);
  });

  it("未割当の節が無ければ LLM を呼ばない", async () => {
    vi.stubEnv("OPENAI_API_KEY", "sk-test");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const assignments = await estimateBatchAssignments(
      voiceFieldOrder(EMPTY_EVENT_FORM, scope()),
      [],
      EMPTY_EVENT_FORM,
      NOW,
      scope(),
    );

    expect(assignments).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("まとめて話す案内", () => {
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

  it("話す順は欄の名前で並べ、郵便番号まで出す", () => {
    const targets = batchTargets(EMPTY_EVENT_FORM, scope());
    const cells = batchPlan(targets);

    // 見本の値ではなく、話す欄の名前を並べる。1 マスは 1 つの欄なので、
    // 開始と終了も別のマスにする（名前を 1 行に収めるため）。
    expect(cells.map((cell) => cell.label)).toEqual([
      "イベント名",
      "開催日",
      "開始時間",
      "終了時間",
      "費用プラン名",
      "費用（円）",
      "場所",
      "郵便番号",
    ]);
    expect(cells.map((cell) => cell.prompt)).toEqual([
      "イベント名は？",
      "開催日は？",
      "開始時間は？",
      "終了時間は？",
      "費用プラン名は？",
      "費用は？",
      "場所は？",
      "郵便番号は？",
    ]);
    // 名前と質問は同じマスから作るので、位置がずれない。
    expect(cells.map((cell) => cell.id)).toEqual([
      "title:0",
      "scheduleDate:0",
      "scheduleStart:0",
      "scheduleEnd:0",
      "planName:0",
      "planAmount:0",
      "venueName:0",
      "postalCode:0",
    ]);
  });

  it("開始と終了は別のマスにし、話す 1 文の例だけ 1 つの言い方にまとめる", () => {
    const cells = batchPlan(batchTargets(EMPTY_EVENT_FORM, scope()));
    const start = cells.find((cell) => cell.id === "scheduleStart:0");
    const end = cells.find((cell) => cell.id === "scheduleEnd:0");

    expect(start?.label).toBe("開始時間");
    expect(end?.label).toBe("終了時間");
    // 開始のマスは「18時から20時」で終了まで読む（マスの id は開始のまま）。
    expect(start?.slotIds).toEqual(["scheduleStart:0", "scheduleEnd:0"]);
    expect(start?.example).toBe("18時から20時");
    // 例の 1 文では 1 回だけ言うので、終了のマスには見本を持たせない。
    expect(end?.example).toBe("");
  });

  it("話す 1 文の例は、話す順に値を並べた 1 文になる", () => {
    const cells = batchPlan(batchTargets(EMPTY_EVENT_FORM, scope()));

    // マスの名前だけでは、値として何を言えばよいか分からない。
    expect(batchExampleSentence(cells)).toBe(
      "忘年会、12月5日、18時から20時、一般、3000円、渋谷ホール、1500001",
    );
  });

  it("入力済みの欄はマスにも出さない", () => {
    const cells = batchPlan(
      batchTargets({ ...EMPTY_EVENT_FORM, title: "秋の音楽会" }, scope()),
    );

    expect(cells.map((cell) => cell.label)).not.toContain("イベント名");
    // 空欄の終了時刻は、別のマスとして残る（開始と畳まない）。
    expect(cells.map((cell) => cell.label)).toContain("終了時間");
  });

  it("同じマスを二度並べない", () => {
    const cells = batchPlan(batchTargets(EMPTY_EVENT_FORM, scope()));
    const ids = cells.map((cell) => cell.id);

    expect(new Set(ids).size).toBe(ids.length);
  });

  it("空欄が 3 つ以上ならまとめてを既定にする", () => {
    const targets = batchTargets(EMPTY_EVENT_FORM, scope());

    expect(defaultVoiceMode(targets.slice(0, 2), EMPTY_EVENT_FORM)).toBe("single");
    expect(defaultVoiceMode(targets.slice(0, 3), EMPTY_EVENT_FORM)).toBe("batch");
  });

  it("行が 1 つで空欄が 3 つ以上なら、まとめてを既定にする", () => {
    const targets = batchTargets(EMPTY_EVENT_FORM, scope());

    expect(targets.length).toBeGreaterThanOrEqual(3);
    expect(defaultVoiceMode(targets, EMPTY_EVENT_FORM)).toBe("batch");
  });

  it("日程が 2 件あると、まとめてではなく 1 つずつを既定にする", () => {
    const value: EventFormValues = {
      ...EMPTY_EVENT_FORM,
      schedules: [
        createScheduleDraft({ key: "schedule-1" }),
        createScheduleDraft({ key: "schedule-2" }),
      ],
    };

    expect(defaultVoiceMode(batchTargets(value, scope()), value)).toBe("single");
  });

  it("男女別の費用があると、まとめてではなく 1 つずつを既定にする", () => {
    const value: EventFormValues = {
      ...EMPTY_EVENT_FORM,
      pricePlans: withGenderPricing(EMPTY_EVENT_FORM.pricePlans),
    };

    expect(value.pricePlans.some((plan) => plan.audience !== "ANY")).toBe(true);
    expect(defaultVoiceMode(batchTargets(value, scope()), value)).toBe("single");
  });

  it("費用プランが 2 組あると、まとめてではなく 1 つずつを既定にする", () => {
    const value: EventFormValues = {
      ...EMPTY_EVENT_FORM,
      pricePlans: [
        createPricePlanDraft({ key: "plan-1" }),
        createPricePlanDraft({ key: "plan-2" }),
      ],
    };

    expect(defaultVoiceMode(batchTargets(value, scope()), value)).toBe("single");
  });

  it("モックの文字起こしは、入力済みの欄の例を含まない", () => {
    vi.stubEnv("VOICE_TRANSCRIBE_MOCK", "1");
    const text = mockBatchTranscript(
      { ...EMPTY_EVENT_FORM, title: "秋の音楽会" },
      scope(),
    );

    expect(text).not.toContain("忘年会");
    expect(text).toContain("12月5日");
  });
});

/** 1 件ぶんのまとめて話すリクエスト。音声の中身はモックでは使わない。 */
function request(options: {
  audioBytes?: number;
  withAudio?: boolean;
  value?: unknown;
  ip?: string;
} = {}): NextRequest {
  const form = new FormData();
  if (options.withAudio !== false) {
    const bytes = new Uint8Array(options.audioBytes ?? 3).fill(1);
    form.append("audio", new File([bytes], "voice.webm", { type: "audio/webm" }));
  }
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
  it("モック有効なら 200 で割当を返す", async () => {
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
    expect(body.text).toContain("、");
    expect(body.assignments.length).toBeGreaterThan(0);
    expect(body.assignments[0]).toHaveProperty("patch");
    expect(body.assignments.map((item) => item.slotId)).toContain("scheduleDate:0");
    expect(Array.isArray(body.unassigned)).toBe(true);
  });

  it("話している間に、読めたマスを cell で先に返す", async () => {
    vi.stubEnv("VOICE_TRANSCRIBE_MOCK", "1");
    vi.stubEnv("OPENAI_API_KEY", "");

    const events = await readEvents(await POST(request()));
    const cells = events.filter((item) => item.event === "cell");

    // 値は返さず、どのマスが読めたかだけを返す。
    expect(cells.length).toBeGreaterThan(0);
    expect(Object.keys(cells[0].data)).toEqual(["slotId"]);
    expect(cells.map((item) => item.data.slotId)).toContain("scheduleDate:0");
    // 同じマスを二度塗らない。
    const slots = cells.map((item) => item.data.slotId);
    expect(new Set(slots).size).toBe(slots.length);
    // `cell` は `done` より前に届く（話している間に塗れる）。
    expect(events.findIndex((item) => item.event === "cell")).toBeLessThan(
      events.findIndex((item) => item.event === "done"),
    );
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

  it("audio が無ければ 400", async () => {
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
