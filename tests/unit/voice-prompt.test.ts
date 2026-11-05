import { describe, expect, it } from "vitest";
import { buildVoicePrompt, VOICE_PROMPT_MAX } from "@/modules/events/lib/voice/prompt";

describe("認識モデルへ渡すプロンプト", () => {
  it("聞いている欄を、短い文脈として 1 文だけ置く", () => {
    const prompt = buildVoicePrompt({ field: "scheduleDate", row: 1 });
    expect(prompt).toBe("イベント作成フォームの「2件目の開催日」を話しています。");
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
    expect(prompt.split("\n")).toHaveLength(2);
  });

  it("手掛かりが無ければその行ごと落とす", () => {
    const prompt = buildVoicePrompt({ field: "title" });
    expect(prompt).not.toContain("入力済み");
    expect(prompt).not.toContain("「」");
    expect(prompt.split("\n")).toHaveLength(1);
  });

  it("片方だけの手掛かりでも文になる", () => {
    const prompt = buildVoicePrompt({ field: "title", title: "忘年会" });
    expect(prompt).toContain("入力済みの催し名は「忘年会」です。");
    expect(prompt).not.toContain("会場");
  });

  it("指示文と数字表記の命令を含めない", () => {
    const prompt = buildVoicePrompt({
      field: "scheduleDate",
      title: "忘年会",
      venueName: "渋谷ホール",
    });
    expect(prompt).not.toContain("してください");
    expect(prompt).not.toContain("書き起こ");
    expect(prompt).not.toContain("算用数字");
    expect(prompt).not.toContain("句読点");
  });

  it("欄の語彙（hint）はプロンプトに混ぜない", () => {
    const prompt = buildVoicePrompt({ field: "scheduleDate" });
    expect(prompt).not.toContain("日付。例:");
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
    expect(prompt.split("\n")).toHaveLength(2);
    expect(prompt.replace(/\n/g, "")).not.toMatch(/[\u0000-\u001f]/u);
  });

  it("700 文字を超える手掛かりは落とし、欄の文脈だけを残す", () => {
    const prompt = buildVoicePrompt({
      field: "title",
      title: "あ".repeat(900),
      venueName: "渋谷ホール",
    });
    expect(prompt.length).toBeLessThanOrEqual(VOICE_PROMPT_MAX);
    expect(prompt).not.toContain("入力済み");
    expect(prompt).toBe("イベント作成フォームの「イベント名」を話しています。");
  });

  it("欄が決まらなくても汎用の文になる", () => {
    const prompt = buildVoicePrompt({ field: null });
    expect(prompt).toBe("イベント作成フォームの入力を話しています。");
    expect(prompt).not.toContain("「");
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
        "イベント作成フォームの「2件目の開催日」を話しています。",
        "入力済みの催し名は「忘年会」、会場は「渋谷ホール」です。",
      ].join("\n"),
    );
  });
});
