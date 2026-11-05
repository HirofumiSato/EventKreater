import { describe, expect, it } from "vitest";
import { voiceFieldByKey } from "@/modules/events/lib/voice/fields";
import {
  buildVoiceKeywords,
  VOICE_KEYWORDS_MAX,
  VOICE_KEYWORD_MAX_LENGTH,
  type VoiceKeywordInput,
} from "@/modules/events/lib/voice/prompt";
import type { VoiceField, VoiceFieldKey } from "@/modules/events/lib/voice/types";

/** `title` の定義を土台にする。語彙だけを差し替えた偽の欄を作るため。 */
function baseField(): VoiceField {
  const field = voiceFieldByKey("title");
  if (!field) throw new Error("title の定義がありません");
  return field;
}

function keywordsOf(key: VoiceFieldKey, input: VoiceKeywordInput = {}): string[] {
  return buildVoiceKeywords(voiceFieldByKey(key), input);
}

const OFFICIAL_PREFECTURES = [
  "北海道",
  "青森県",
  "岩手県",
  "宮城県",
  "秋田県",
  "山形県",
  "福島県",
  "茨城県",
  "栃木県",
  "群馬県",
  "埼玉県",
  "千葉県",
  "東京都",
  "神奈川県",
  "新潟県",
  "富山県",
  "石川県",
  "福井県",
  "山梨県",
  "長野県",
  "岐阜県",
  "静岡県",
  "愛知県",
  "三重県",
  "滋賀県",
  "京都府",
  "大阪府",
  "兵庫県",
  "奈良県",
  "和歌山県",
  "鳥取県",
  "島根県",
  "岡山県",
  "広島県",
  "山口県",
  "徳島県",
  "香川県",
  "愛媛県",
  "高知県",
  "福岡県",
  "佐賀県",
  "長崎県",
  "熊本県",
  "大分県",
  "宮崎県",
  "鹿児島県",
  "沖縄県",
];

describe("欄ごとの語彙", () => {
  it("都道府県は 47 の正式名と略称を持つ", () => {
    const keywords = voiceFieldByKey("prefecture")?.keywords ?? [];
    for (const name of OFFICIAL_PREFECTURES) {
      expect(keywords, `${name} が語彙に無い`).toContain(name);
    }
    expect(keywords).toContain("東京");
    expect(keywords).toContain("大阪");
    expect(keywords).toContain("京都");
    expect(keywords).toContain("沖縄");
    // 同じ語を 2 度持たない。
    expect(new Set(keywords).size).toBe(keywords.length);
  });

  it("雨天時の方針は、その欄で実際に言う語を持つ", () => {
    expect(keywordsOf("rainPolicy")).toEqual(
      expect.arrayContaining(["雨天決行", "雨天中止", "順延", "屋内開催"]),
    );
  });

  it("金額は円と無料を持つ", () => {
    expect(keywordsOf("planAmount")).toEqual(expect.arrayContaining(["円", "無料"]));
  });

  it("プラン名は一般・学生・男性・女性を持つ", () => {
    expect(keywordsOf("planName")).toEqual(
      expect.arrayContaining(["一般", "学生", "男性", "女性"]),
    );
  });

  it("欄の語彙を持たない欄でも空配列を返す", () => {
    const field: VoiceField = { ...baseField(), keywords: undefined };
    expect(buildVoiceKeywords(field)).toEqual([]);
  });
});

describe("入力済みの値の混ぜ方", () => {
  it("入力済みの催し名と会場名を先に置く", () => {
    expect(
      keywordsOf("scheduleDate", { title: "忘年会", venueName: "渋谷ホール" }),
    ).toEqual(expect.arrayContaining(["忘年会", "渋谷ホール"]));
    const words = keywordsOf("scheduleDate", { title: "忘年会", venueName: "渋谷ホール" });
    expect(words.slice(0, 2)).toEqual(["忘年会", "渋谷ホール"]);
  });

  it("いま聞いている欄の現在値は入れない", () => {
    // 欄の語彙とたまたま同じ語（忘年会・ホール）ではなく、欄にしか無い値で確かめる。
    expect(keywordsOf("title", { title: "秋の集い" })).not.toContain("秋の集い");
    expect(keywordsOf("venueName", { venueName: "駅前ホール" })).not.toContain("駅前ホール");
  });

  it("欄が決まらなくても、入力済みの値だけを返す", () => {
    expect(buildVoiceKeywords(null, { title: "忘年会", venueName: "渋谷ホール" })).toEqual([
      "忘年会",
      "渋谷ホール",
    ]);
  });
});

describe("語彙の整え方", () => {
  it("重複を落とす", () => {
    const field: VoiceField = { ...baseField(), keywords: ["円", "円", " 円 "] };
    expect(buildVoiceKeywords(field)).toEqual(["円"]);
  });

  it("空の語と空白だけの語を落とす", () => {
    const field: VoiceField = { ...baseField(), keywords: ["", "  ", "\n", "\t"] };
    expect(buildVoiceKeywords(field)).toEqual([]);
  });

  it("`<` `>` と改行・制御文字を除去する", () => {
    const field: VoiceField = {
      ...baseField(),
      keywords: ["<東京>", "渋谷\r\nホール", "a\tb"],
    };
    expect(buildVoiceKeywords(field)).toEqual(["東京", "渋谷ホール", "ab"]);
  });

  it("入力済みの値からも禁止文字を除去する", () => {
    expect(buildVoiceKeywords(null, { title: "忘<年会>\n" })).toEqual(["忘年会"]);
  });

  it("1 語は 60 文字で切る", () => {
    const field: VoiceField = { ...baseField(), keywords: ["あ".repeat(70)] };
    const words = buildVoiceKeywords(field);
    expect(words).toHaveLength(1);
    expect(words[0]).toHaveLength(VOICE_KEYWORD_MAX_LENGTH);
    expect(VOICE_KEYWORD_MAX_LENGTH).toBe(60);
  });

  it("20 語で切る", () => {
    const field: VoiceField = {
      ...baseField(),
      keywords: Array.from({ length: 25 }, (_, index) => `語${index}`),
    };
    const words = buildVoiceKeywords(field);
    expect(words).toHaveLength(VOICE_KEYWORDS_MAX);
    expect(VOICE_KEYWORDS_MAX).toBe(20);
    expect(words.at(-1)).toBe("語19");
  });

  it("都道府県は送信時に 20 語へ絞る", () => {
    const words = keywordsOf("prefecture");
    expect(words).toHaveLength(VOICE_KEYWORDS_MAX);
    expect(words).toContain("東京都");
    expect(words).toContain("東京");
  });
});
