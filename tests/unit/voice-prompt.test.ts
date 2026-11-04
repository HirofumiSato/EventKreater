import { describe, expect, it } from "vitest";
import { buildVoicePrompt, VOICE_PROMPT_MAX } from "@/modules/events/lib/voice/prompt";

describe("認識モデルへ渡すプロンプト", () => {
  it("日本語であることと、聞いている欄の名前を 1 行目に置く", () => {
    const prompt = buildVoicePrompt({ field: "scheduleDate", row: 1 });
    expect(prompt.split("\n")[0]).toBe(
      "日本語の音声を、イベント作成フォームの「2件目の開催日」に入れる値として書き起こしてください。",
    );
    expect(prompt).toContain("日本語");
  });

  it("女性の金額は行の番号ではなく性別で呼ぶ", () => {
    const prompt = buildVoicePrompt({ field: "planAmount", row: 1 });
    expect(prompt).toContain("「女性の金額」");
  });

  it("入力済みの催し名と会場名を当て字の手掛かりとして置く", () => {
    const prompt = buildVoicePrompt({
      field: "title",
      title: "忘年会",
      venueName: "渋谷ホール",
    });
    expect(prompt).toContain("催し名は「忘年会」");
    expect(prompt).toContain("会場は「渋谷ホール」");
  });

  it("手掛かりが無ければその行ごと落とす", () => {
    const prompt = buildVoicePrompt({ field: "title" });
    expect(prompt).not.toContain("入力済み");
    expect(prompt).not.toContain("「」");
    expect(prompt.split("\n")).toHaveLength(4);
  });

  it("片方だけの手掛かりでも文になる", () => {
    const prompt = buildVoicePrompt({ field: "title", title: "忘年会" });
    expect(prompt).toContain("入力済みの催し名は「忘年会」です。");
    expect(prompt).not.toContain("会場");
  });

  it("改行と制御文字は空白へ潰す", () => {
    const prompt = buildVoicePrompt({
      field: "title",
      title: "忘\n年会\u0007",
      venueName: "渋谷\tホール",
    });
    expect(prompt).toContain("催し名は「忘 年会」");
    expect(prompt).toContain("会場は「渋谷 ホール」");
    // 行の区切りだけが改行として残る。
    expect(prompt.split("\n")).toHaveLength(5);
    expect(prompt.replace(/\n/g, "")).not.toMatch(/[\u0000-\u001f]/u);
  });

  it("700 文字を超える手掛かりは後ろから落とす", () => {
    const prompt = buildVoicePrompt({
      field: "title",
      title: "あ".repeat(900),
      venueName: "渋谷ホール",
    });
    expect(prompt.length).toBeLessThanOrEqual(VOICE_PROMPT_MAX);
    expect(prompt).not.toContain("入力済み");
  });

  it("欄が決まらなくても汎用の文になる", () => {
    const prompt = buildVoicePrompt({ field: null });
    expect(prompt).toContain("日本語の音声を、イベント作成フォームに入れる値として書き起こしてください。");
    expect(prompt).not.toContain("「");
    expect(prompt.split("\n")).toHaveLength(3);
  });

  it("組み立てた文字列を通しで固定する", () => {
    expect(
      buildVoicePrompt({
        field: "scheduleDate",
        row: 1,
        title: "忘年会",
        venueName: "渋谷ホール",
      }),
    ).toBe(
      [
        "日本語の音声を、イベント作成フォームの「2件目の開催日」に入れる値として書き起こしてください。",
        "日付。例: 12月5日、2026年12月5日。",
        "話した語だけを書き、説明や句読点は足さないでください。",
        "数字は算用数字にし、単位（円・人・日・時）は話したとおりに残してください。",
        "入力済みの催し名は「忘年会」、会場は「渋谷ホール」です。同じ読みの語はこの表記に寄せてください。",
      ].join("\n"),
    );
  });
});
