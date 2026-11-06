// 初回ガイドの 8 枚の並びと文言。
//
// 画面（`EventGuideTour`）はこの定義をそのまま描くので、順番・対象・開くステップが
// 変わると、ガイドの意味が変わる。文言も含めてここで固定する。

import { describe, expect, it } from "vitest";
import { EVENT_STEPS, type EventStepKey } from "@/modules/events/lib/steps";
import {
  EVENT_GUIDE_ACTION_COPY,
  EVENT_GUIDE_STEPS,
  eventGuideStep,
  guideCopy,
  guideOpenKeys,
  type EventGuideKey,
} from "@/modules/events/lib/tour/steps";

describe("8 枚の並び", () => {
  it("画面名の挨拶から始まり、最後に画面下の帯で終わる", () => {
    expect(EVENT_GUIDE_STEPS.map((step) => step.key)).toEqual([
      "welcome",
      "required",
      "schedule",
      "pricing",
      "target",
      "theme",
      "flyer",
      "final",
    ]);
  });

  it("最初の枚は、画面名と「これから説明する」ことだけを伝える", () => {
    const copy = eventGuideStep("welcome").copy;

    expect(copy.title).toBe("新規イベント作成へようこそ");
    expect(copy.body).toContain("使い方");
    expect(copy.note).toContain("次へ");
  });

  it("最初の枚はアコーディオンを動かさない（既定で開いている基本をそのまま見せる）", () => {
    expect(eventGuideStep("welcome").openStep).toBeNull();
  });

  it("最終枚は 1 つだけで、そこにだけ「次回から表示しない」を出す", () => {
    const finals = EVENT_GUIDE_STEPS.filter((step) => step.final);

    expect(finals).toHaveLength(1);
    expect(finals[0].key).toBe("final");
  });

  it("どの枚にも対象のセレクタがある（穴の無い枚を作らない）", () => {
    for (const step of EVENT_GUIDE_STEPS) {
      expect(step.targets.length).toBeGreaterThan(0);
      for (const selector of step.targets) expect(selector).not.toBe("");
    }
  });

  it("2 枚目は必須 3 ステップの見出しを、1 つずつ指す", () => {
    const step = eventGuideStep("required");

    expect(step.targets).toEqual([
      "#event-step-basic-toggle",
      "#event-step-pricing-toggle",
      "#event-step-location-toggle",
    ]);
    expect(step.separateTargets).toBe(true);
  });

  it("2 枚目だけ、穴の中を押せる（見出しを押して開閉を試せる）", () => {
    const step = eventGuideStep("required");

    // 押せる枚は透明な層を外し、代わりに手の合図を出す。
    expect(step.pressable).toBe(true);
    for (const entry of EVENT_GUIDE_STEPS.filter((item) => item.key !== "required")) {
      expect(entry.pressable).toBeUndefined();
    }
  });

  it("3 枚目と 5 枚目は、画面に足した目印を指す", () => {
    expect(eventGuideStep("schedule").targets).toEqual(['[data-guide-target="add-schedule"]']);
    expect(eventGuideStep("target").targets).toEqual([
      '[data-guide-target="target-generation"]',
    ]);
  });

  it("6 枚目と 7 枚目は、同じステップの中の別の欄を指す", () => {
    expect(eventGuideStep("theme").targets).toEqual([
      "#event-step-flyer .event-step__block--theme",
    ]);
    expect(eventGuideStep("flyer").targets).toEqual([
      "#event-step-flyer .event-step__block--flyer",
    ]);
  });

  it("最後の枚は画面下の帯を指す", () => {
    expect(eventGuideStep("final").targets).toEqual([".form-final"]);
  });
});

describe("開くステップの移り変わり", () => {
  it("最初は動かさず、2 枚目で全部畳み、3 枚目から全部開いたままにする", () => {
    expect(EVENT_GUIDE_STEPS.map((step) => step.openStep)).toEqual([
      null,
      "closed",
      "all",
      "all",
      "all",
      "all",
      "all",
      null,
    ]);
  });

  it("開いたままの枚は、対象だけを移す（開閉を作り直さない）", () => {
    const opened = EVENT_GUIDE_STEPS.filter((step) => step.openStep === "all");

    expect(opened.map((step) => step.key)).toEqual([
      "schedule",
      "pricing",
      "target",
      "theme",
      "flyer",
    ]);
  });

  it("2 枚目は 3 つの見出しを別々の穴で囲む（1 つの箱にまとめない）", () => {
    expect(eventGuideStep("required").separateTargets).toBe(true);
  });

  it("2 枚目以外は、対象をまとめた 1 つの穴で囲む", () => {
    for (const step of EVENT_GUIDE_STEPS.filter((entry) => entry.key !== "required")) {
      expect(step.separateTargets).toBeUndefined();
    }
  });

  it("前のステップを開き直さない（後ろへ戻る枚を作らない）", () => {
    const order = ["basic", "pricing", "location", "capacity", "flyer"];
    const opened = EVENT_GUIDE_STEPS.map((step) => step.openStep).filter(
      (key): key is EventStepKey => key !== null && key !== "closed" && key !== "all",
    );
    const positions = opened.map((key) => order.indexOf(key));

    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });

  it("最終枚は開閉を変えない（直前のステップを開いたまま見せる）", () => {
    expect(eventGuideStep("final").openStep).toBeNull();
  });
});

describe("最終枚の文言", () => {
  it("ゲストには、登録のあとで公開できることと入力が残ることを伝える", () => {
    const copy = guideCopy(eventGuideStep("final"), false);

    expect(copy.body).toContain("登録のあと");
    expect(copy.note).toContain("入力はそのまま残ります");
  });

  it("ログイン済みには、プレビューと下書きを案内する", () => {
    const copy = guideCopy(eventGuideStep("final"), true);

    expect(copy.body).toContain("プレビュー");
    expect(copy.note).toContain("下書き");
  });

  it("最終枚以外は、ログインの有無で文言を変えない", () => {
    for (const step of EVENT_GUIDE_STEPS.filter((entry) => !entry.final)) {
      expect(guideCopy(step, true)).toBe(guideCopy(step, false));
    }
  });

  it("すべての枚に見出しと、本文か箇条書きがある", () => {
    for (const step of EVENT_GUIDE_STEPS) {
      expect(step.copy.title.length).toBeGreaterThan(0);
      const hasBody = (step.copy.body?.length ?? 0) > 0;
      const hasBullets = (step.copy.bullets?.length ?? 0) > 0;
      expect(hasBody || hasBullets).toBe(true);
    }
  });

  it("本文と箇条書きは同じ枚に並べない（同じことを 2 回言わない）", () => {
    for (const step of EVENT_GUIDE_STEPS) {
      const hasBody = (step.copy.body?.length ?? 0) > 0;
      const hasBullets = (step.copy.bullets?.length ?? 0) > 0;
      expect(hasBody && hasBullets).toBe(false);
    }
  });

  it("費用の枚は、3 つの作り方を番号なしの箇条書きで並べる", () => {
    const copy = eventGuideStep("pricing").copy;

    expect(copy.title).toBe("料金プランをカスタマイズ");
    expect(copy.bullets).toEqual(["男女別の金額", "飲み放題などの別プラン", "割引"]);
    expect(copy.body).toBeUndefined();
  });
});

describe("開くステップの決め方", () => {
  const ALL = EVENT_STEPS.map((step) => step.key);

  it("`all` は 5 つとも開く", () => {
    const next = guideOpenKeys("all", new Set<EventStepKey>(["basic"]));

    expect(next.size).toBe(ALL.length);
    for (const key of ALL) expect(next.has(key)).toBe(true);
  });

  it("すでに全部開いていれば、同じ集合を返す（描き直さない）", () => {
    const open = new Set<EventStepKey>(ALL);

    expect(guideOpenKeys("all", open)).toBe(open);
  });

  it("`closed` は空にする。空なら同じ集合を返す", () => {
    expect(guideOpenKeys("closed", new Set<EventStepKey>(["basic"])).size).toBe(0);
    const empty = new Set<EventStepKey>();
    expect(guideOpenKeys("closed", empty)).toBe(empty);
  });

  it("ステップ 1 つを渡すと、その 1 つだけを開く", () => {
    const next = guideOpenKeys("pricing", new Set<EventStepKey>(ALL));

    expect([...next]).toEqual(["pricing"]);
  });

  it("すでにその 1 つだけなら、同じ集合を返す", () => {
    const open = new Set<EventStepKey>(["pricing"]);

    expect(guideOpenKeys("pricing", open)).toBe(open);
  });

  it("`null` は今のまま（開閉を動かさない）", () => {
    const open = new Set<EventStepKey>(["basic"]);

    expect(guideOpenKeys(null, open)).toBe(open);
  });
});

describe("操作の文言", () => {
  it("戻る・次へ・はじめるを 1 か所に持つ", () => {
    expect(EVENT_GUIDE_ACTION_COPY).toMatchObject({
      back: "戻る",
      next: "次へ",
      start: "はじめる",
      close: "ガイドを閉じる",
    });
  });
});

describe("知らないキー", () => {
  it("別の枚を黙って返さず、例外にする", () => {
    expect(() => eventGuideStep("unknown" as EventGuideKey)).toThrow(
      "unknown event guide step: unknown",
    );
  });
});
