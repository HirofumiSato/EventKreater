import { afterEach, describe, expect, it, vi } from "vitest";
import {
  proposeBackgroundCandidates,
  proposeTypeCandidates,
} from "@/modules/flyers/lib/flyer";
import type { GenerateFlyerInput } from "@/lib/schemas";

const INPUT: GenerateFlyerInput = {
  title: "川辺の焚き火ナイト",
  eventDate: "2026-11-14",
  eventTime: "18:30〜21:00",
  price: "3,000円",
  location: "多摩川河川敷",
  rainPolicy: "RAIN_OR_SHINE",
  capacity: 15,
  templateId: "style_1_bar_stylish",
  layoutId: "classic",
};

const CANDIDATE = {
  candidate_id: "0f6a2c6e-6f2a-4c1a-9f3e-6e2b0f3a1c11",
  kind: "background",
  label: "テーマの下地",
  description: "",
  image_url: "/api/v1/flyers/candidates/0f6a2c6e",
  template_id: "style_1_bar_stylish",
  layout_id: "classic",
  palette_id: "theme",
  accent_color: "#8B2635",
  overlay_alpha: 0.55,
  source: "placeholder",
  ai_remaining: 0,
};

function stubFetch(payload: unknown): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(JSON.stringify(payload), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    ),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("proposeBackgroundCandidates", () => {
  it("AI が代替背景へ落ちたことを応答から読む", async () => {
    stubFetch({ candidates: [CANDIDATE], ai_fallback: true });

    const list = await proposeBackgroundCandidates(INPUT, 1);

    expect(list.aiFallback).toBe(true);
    expect(list.candidates).toHaveLength(1);
  });

  it("ai_fallback が無い古い応答は代替なしとみなす", async () => {
    stubFetch({ candidates: [CANDIDATE] });

    expect((await proposeBackgroundCandidates(INPUT, 1)).aiFallback).toBe(false);
  });
});

describe("proposeTypeCandidates", () => {
  it("背景のステップ以外は候補の配列だけを返す", async () => {
    stubFetch({ candidates: [{ ...CANDIDATE, kind: "type" }], ai_fallback: true });

    expect(await proposeTypeCandidates(INPUT)).toHaveLength(1);
  });
});
