import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/v1/voice/utterances/route";
import { assignBatch, estimateBatchAssignments } from "@/modules/events/lib/voice/batch";
import { MAX_AUDIO_BYTES } from "@/modules/events/lib/voice/audio";
import { voiceFieldOrder } from "@/modules/events/lib/voice/fields";
import type { VoiceFieldScope } from "@/modules/events/lib/voice/types";
import { EMPTY_EVENT_FORM, type EventFormValues } from "@/modules/events/types";

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

describe("POST /api/v1/voice/utterances", () => {
  it("モック有効なら 200 で割当を返す", async () => {
    vi.stubEnv("VOICE_TRANSCRIBE_MOCK", "1");
    vi.stubEnv("OPENAI_API_KEY", "");

    const response = await POST(request());

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
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
    const body = (await response.json()) as { text: string; model: string };
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
