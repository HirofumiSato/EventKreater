import { describe, expect, it } from "vitest";
import {
  EVENT_SUMMARY_MAX_LENGTH,
  escapeSummaryHtml,
  normalizeSummaryLinkUrl,
  summaryText,
  summaryTextLength,
} from "@/modules/events/lib/summary";
import { sanitizeEventSummary } from "@/modules/events/lib/summary-html";

/**
 * イベント概要（リッチテキスト）の純ロジックと無害化の仕様。
 *
 * 数えるのは「画面に出る文字」だけにする。タグ・改行・実体参照の書き方は数えない。
 * 保存する前に必ず `sanitizeEventSummary` を通し、許可タグだけの HTML だけを残す。
 */

describe("summaryTextLength の数え方", () => {
  it("タグは数えず、中の文字だけを数える", () => {
    expect(summaryTextLength("<b>太字</b>")).toBe(2);
    expect(summaryTextLength("<p>段落</p>")).toBe(2);
    expect(summaryTextLength("<span>飾り</span>")).toBe(2);
  });

  it("実体参照は 1 文字として数える（&amp; は 1 文字）", () => {
    expect(summaryTextLength("&amp;")).toBe(1);
    expect(summaryTextLength("<b>&amp;</b>")).toBe(1);
    expect(summaryTextLength("&lt;b&gt;")).toBe(3);
    expect(summaryText("&amp;")).toBe("&");
  });

  it("<br> と段落・リストの境界は文字数に足さない", () => {
    expect(summaryTextLength("あ<br>い")).toBe(2);
    expect(summaryTextLength("<p>あ</p><p>い</p>")).toBe(2);
    expect(summaryTextLength("<ul><li>あ</li><li>い</li></ul>")).toBe(2);
    // 続けた改行や空行も文字数を増やさない。
    expect(summaryTextLength("あ<br><br><br>い")).toBe(2);
    expect(summaryTextLength("<p>あ</p><p></p><p>い</p>")).toBe(2);
  });

  it("連続する空白は 1 つにそろえる（全角空白・タブも同じ扱い）", () => {
    expect(summaryText("<b>あ</b>   <i>い</i>")).toBe("あ い");
    expect(summaryTextLength("<b>あ</b>   <i>い</i>")).toBe(3);
    expect(summaryTextLength("あ\u3000い")).toBe(3);
    expect(summaryTextLength("\tあ\tい\t")).toBe(3);
  });

  it("上限は 200 文字で、ちょうど 200 は通り 201 は超える", () => {
    expect(EVENT_SUMMARY_MAX_LENGTH).toBe(200);
    expect(summaryTextLength("あ".repeat(200))).toBe(200);
    expect(summaryTextLength("あ".repeat(200)) <= EVENT_SUMMARY_MAX_LENGTH).toBe(true);
    expect(summaryTextLength("あ".repeat(201))).toBe(201);
    expect(summaryTextLength("あ".repeat(201)) <= EVENT_SUMMARY_MAX_LENGTH).toBe(false);
    // タグを付けても表示文字数は変わらない。
    expect(summaryTextLength(`<b>${"あ".repeat(200)}</b>`)).toBe(200);
  });

  it("空文字は 0 文字", () => {
    expect(summaryTextLength("")).toBe(0);
    expect(summaryText("")).toBe("");
  });
});

describe("normalizeSummaryLinkUrl の検証", () => {
  it("http と https はそのまま通す", () => {
    expect(normalizeSummaryLinkUrl("http://example.com/path")).toBe("http://example.com/path");
    expect(normalizeSummaryLinkUrl("https://example.com/path")).toBe("https://example.com/path");
  });

  it("スキームを省略した入力には https を補う", () => {
    expect(normalizeSummaryLinkUrl("example.com/path")).toBe("https://example.com/path");
  });

  it("前後の空白は落とす", () => {
    expect(normalizeSummaryLinkUrl("  https://example.com  ")).toBe("https://example.com");
  });

  it("javascript・data・mailto・tel・ftp は受け付けない", () => {
    expect(normalizeSummaryLinkUrl("javascript:alert(1)")).toBeNull();
    expect(normalizeSummaryLinkUrl("JavaScript:alert(1)")).toBeNull();
    expect(normalizeSummaryLinkUrl("data:text/html,<b>x</b>")).toBeNull();
    expect(normalizeSummaryLinkUrl("mailto:info@example.com")).toBeNull();
    expect(normalizeSummaryLinkUrl("tel:0312345678")).toBeNull();
    expect(normalizeSummaryLinkUrl("ftp://example.com/file")).toBeNull();
  });

  it("空文字と、途中に空白が混ざる入力は URL にしない", () => {
    expect(normalizeSummaryLinkUrl("   ")).toBeNull();
    expect(normalizeSummaryLinkUrl("java script:alert(1)")).toBeNull();
  });
});

describe("sanitizeEventSummary の無害化", () => {
  it("許可タグはそのまま残す", () => {
    expect(sanitizeEventSummary("<b>太字</b>")).toBe("<b>太字</b>");
    expect(sanitizeEventSummary("<strong>強調</strong>")).toBe("<strong>強調</strong>");
    expect(sanitizeEventSummary("<i>斜体</i>")).toBe("<i>斜体</i>");
    expect(sanitizeEventSummary("<em>強調</em>")).toBe("<em>強調</em>");
    expect(sanitizeEventSummary("<u>下線</u>")).toBe("<u>下線</u>");
    expect(sanitizeEventSummary("<p>段落</p>")).toBe("<p>段落</p>");
    expect(sanitizeEventSummary("<ul><li>項目</li></ul>")).toBe("<ul><li>項目</li></ul>");
    expect(sanitizeEventSummary("<ol><li>項目</li></ol>")).toBe("<ol><li>項目</li></ol>");
  });

  it("script と style は中身ごと落とす", () => {
    expect(sanitizeEventSummary('<b>安全</b><script>alert("x")</script>')).toBe("<b>安全</b>");
    expect(sanitizeEventSummary("<style>p{color:red}</style>あ")).toBe("あ");
  });

  it("style 属性と on* の属性は落とす", () => {
    expect(sanitizeEventSummary('<p style="color:red">あ</p>')).toBe("<p>あ</p>");
    expect(sanitizeEventSummary('<b onclick="alert(1)">あ</b>')).toBe("<b>あ</b>");
    expect(sanitizeEventSummary('<p onmouseover="alert(1)">あ</p>')).toBe("<p>あ</p>");
  });

  it("不正な href はリンクをやめて文字だけ残す", () => {
    const result = sanitizeEventSummary('<a href="javascript:alert(1)">こちら</a>');
    expect(result).not.toContain("<a");
    expect(result).not.toContain("javascript");
    expect(result).toBe("<span>こちら</span>");
  });

  it("有効なリンクは新しいタブで開き、参照元を渡さない", () => {
    const result = sanitizeEventSummary('<a href="https://example.com">こちら</a>');
    expect(result).toContain("<a");
    expect(result).toContain('href="https://example.com"');
    expect(result).toContain('target="_blank"');
    expect(result).toContain("noopener");
    expect(result).toContain("noreferrer");
  });

  it("スキームを省略したリンクには https を補う", () => {
    const result = sanitizeEventSummary('<a href="example.com/path">こちら</a>');
    expect(result).toContain('href="https://example.com/path"');
  });

  it("空文字は空文字のまま", () => {
    expect(sanitizeEventSummary("")).toBe("");
  });
});

describe("escapeSummaryHtml の変換", () => {
  it("< > & 引用符を実体参照にする", () => {
    expect(escapeSummaryHtml('a < b & c > d "e" \'f\'')).toBe(
      "a &lt; b &amp; c &gt; d &quot;e&quot; &#39;f&#39;",
    );
  });

  it("改行は <br> にする", () => {
    expect(escapeSummaryHtml("1行目\n2行目")).toBe("1行目<br>2行目");
  });

  it("タグを含まない普通の文はそのまま残る", () => {
    expect(escapeSummaryHtml("秋の芋煮会")).toBe("秋の芋煮会");
  });
});
