import { describe, expect, it } from "vitest";
import { PDFDict, PDFDocument, PDFName } from "pdf-lib";
import sharp from "sharp";
import {
  A4_HEIGHT_PT,
  A4_WIDTH_PT,
  buildFlyerPdf,
} from "@/modules/flyers/lib/pdf";
import {
  flyerEventPagePath,
  flyerPdfDownloadFilename,
  flyerPdfDownloadHref,
} from "@/modules/flyers/lib/pdf-link";

const QR_URL = "https://example.com/events/11111111-2222-3333-4444-555555555555";

async function png(): Promise<Uint8Array> {
  return sharp({
    create: {
      width: 108,
      height: 153,
      channels: 3,
      background: { r: 240, g: 236, b: 228 },
    },
  })
    .png()
    .toBuffer();
}

describe("flyerPdfDownloadHref", () => {
  it("チラシ ID とイベント ID を PDF の取得 URL に載せる", () => {
    expect(flyerPdfDownloadHref("abc", "evt")).toBe(
      "/api/v1/flyer-assets/abc/pdf?eventId=evt",
    );
  });

  it("ID は URL に載せられる形へエスケープする", () => {
    expect(flyerPdfDownloadHref("a/b", "e/1")).toBe(
      "/api/v1/flyer-assets/a%2Fb/pdf?eventId=e%2F1",
    );
  });
});

describe("flyerEventPagePath", () => {
  it("告知ページのパスを作る", () => {
    expect(flyerEventPagePath("abc")).toBe("/events/abc");
  });
});

describe("flyerPdfDownloadFilename", () => {
  it("催し名を使い、拡張子は pdf にする", () => {
    expect(flyerPdfDownloadFilename("忘年会 2026", "id")).toBe(
      "チラシ-忘年会 2026.pdf",
    );
  });

  it("催し名が無ければ ID で作る", () => {
    expect(flyerPdfDownloadFilename(null, "abc")).toBe("flyer-abc.pdf");
    expect(flyerPdfDownloadFilename("   ", "abc")).toBe("flyer-abc.pdf");
  });

  it("ファイル名に使えない文字を落とす", () => {
    expect(flyerPdfDownloadFilename('a/b:c*d?e"f<g>h|i\\j', "id")).toBe(
      "チラシ-a b c d e f g h i j.pdf",
    );
  });
});

describe("buildFlyerPdf", () => {
  it("A4 縦 1 ページの PDF を返す", async () => {
    const pdf = await buildFlyerPdf({ image: await png(), qrUrl: QR_URL });
    expect(Buffer.from(pdf.subarray(0, 5)).toString("latin1")).toBe("%PDF-");

    const loaded = await PDFDocument.load(pdf);
    expect(loaded.getPageCount()).toBe(1);
    const { width, height } = loaded.getPage(0).getSize();
    expect(width).toBeCloseTo(A4_WIDTH_PT, 1);
    expect(height).toBeCloseTo(A4_HEIGHT_PT, 1);
  });

  it("チラシ画像だけを画像として埋め込み、QR は図形で描く", async () => {
    const pdf = await buildFlyerPdf({ image: await png(), qrUrl: QR_URL });
    const loaded = await PDFDocument.load(pdf);
    const resources = loaded.getPage(0).node.Resources();
    const images = resources?.lookup(PDFName.of("XObject"), PDFDict);
    expect(images?.keys()).toHaveLength(1);
  });

  it("URL が長いほど QR のモジュールが増え、PDF も大きくなる", async () => {
    const image = await png();
    const short = await buildFlyerPdf({ image, qrUrl: "https://a.example/e/1" });
    const long = await buildFlyerPdf({
      image,
      qrUrl: `https://example.com/events/${"a".repeat(150)}`,
    });
    expect(long.length).toBeGreaterThan(short.length);
  });

  it("WebP のチラシも JPEG へ変換して埋め込む", async () => {
    const webp = await sharp(await png()).webp().toBuffer();
    const pdf = await buildFlyerPdf({ image: webp, qrUrl: QR_URL });
    const loaded = await PDFDocument.load(pdf);
    expect(loaded.getPageCount()).toBe(1);
  });

  it("画像と判別できないバイト列は拒否する", async () => {
    await expect(
      buildFlyerPdf({ image: new Uint8Array([1, 2, 3]), qrUrl: QR_URL }),
    ).rejects.toThrow("チラシ画像の形式を判別できませんでした。");
  });
});
