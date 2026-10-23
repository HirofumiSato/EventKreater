import { describe, expect, it } from "vitest";
import {
  contentDisposition,
  flyerDownloadFilename,
  flyerDownloadHref,
} from "@/modules/flyers/lib/download";

describe("flyerDownloadHref", () => {
  it("画像の取得に download=1 を付ける", () => {
    expect(flyerDownloadHref("abc")).toBe(
      "/api/v1/flyer-assets/abc/image?download=1",
    );
  });

  it("ID は URL に載せられる形へエスケープする", () => {
    expect(flyerDownloadHref("a/b")).toBe(
      "/api/v1/flyer-assets/a%2Fb/image?download=1",
    );
  });
});

describe("flyerDownloadFilename", () => {
  it("催し名をファイル名に入れる", () => {
    expect(flyerDownloadFilename("忘年会 2026", "jpeg", "id")).toBe(
      "チラシ-忘年会 2026.jpg",
    );
  });

  it("拡張子は保存した形式に合わせる", () => {
    expect(flyerDownloadFilename("夏祭り", "png", "id")).toBe("チラシ-夏祭り.png");
    expect(flyerDownloadFilename("夏祭り", "webp", "id")).toBe("チラシ-夏祭り.webp");
  });

  it("ファイル名に使えない文字を落とし、空白を1つにまとめる", () => {
    expect(flyerDownloadFilename('a/b:c*d?e"f<g>h|i\\j', "jpeg", "id")).toBe(
      "チラシ-a b c d e f g h i j.jpg",
    );
  });

  it("制御文字を落とす", () => {
    expect(flyerDownloadFilename("忘年\u0000会\u001f", "jpeg", "id")).toBe(
      "チラシ-忘年 会.jpg",
    );
  });

  it("催し名が無ければ ID で作る", () => {
    expect(flyerDownloadFilename("   ", "webp", "abc")).toBe("flyer-abc.webp");
    expect(flyerDownloadFilename(null, "jpeg", "abc")).toBe("flyer-abc.jpg");
    expect(flyerDownloadFilename(undefined, "png", "abc")).toBe("flyer-abc.png");
  });

  it("長すぎる催し名は 60 文字で切る", () => {
    expect(flyerDownloadFilename("あ".repeat(100), "jpeg", "id")).toBe(
      `チラシ-${"あ".repeat(60)}.jpg`,
    );
  });
});

describe("contentDisposition", () => {
  it("ASCII の filename と日本語の filename* を併記する", () => {
    const value = contentDisposition("attachment", "チラシ-忘年会.jpg");
    expect(value).toBe(
      'attachment; filename="___-___.jpg"; filename*=UTF-8\'\'%E3%83%81%E3%83%A9%E3%82%B7-%E5%BF%98%E5%B9%B4%E4%BC%9A.jpg',
    );
  });

  it("filename* では ' ( ) * をパーセントエンコードする", () => {
    expect(contentDisposition("inline", "a'b(c)d*e.jpg")).toContain(
      "filename*=UTF-8''a%27b%28c%29d%2Ae.jpg",
    );
  });

  it("ASCII 名に使えない引用符とバックスラッシュを潰す", () => {
    expect(contentDisposition("attachment", 'a"b\\c.jpg')).toContain(
      'filename="a_b_c.jpg"',
    );
  });
});
