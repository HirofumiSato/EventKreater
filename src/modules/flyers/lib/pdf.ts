/**
 * チラシ画像を A4 縦の PDF にし、告知ページの QR コードを右下へ重ねる。
 *
 * サーバー専用。Next の request にも DB にも依存しない。画像バイト列と QR に
 * 焼き込む URL だけを受け取る。QR を焼き込むのはダウンロード時である。下書きの
 * 時点では告知 URL が確定していないため、生成した画像そのものには入れない。
 */
import QRCode from "qrcode";
import {
  PDFDocument,
  StandardFonts,
  rgb,
  type PDFDocument as PDFDocumentType,
  type PDFFont,
  type PDFImage,
  type PDFPage,
} from "pdf-lib";
import { detectImageKind } from "@/modules/flyers/lib/upload";

/** A4 縦（210mm × 297mm）のポイント数。PDF の座標は 1pt = 1/72 インチ。 */
export const A4_WIDTH_PT = 595.28;
export const A4_HEIGHT_PT = 841.89;

/** ページ端から QR パネルまでの余白。 */
const PAGE_MARGIN_PT = 16;
/** QR の暗モジュール色。白パネルの上に置く。 */
const QR_DARK = rgb(0.07, 0.09, 0.15);
/** QR の誤り訂正レベル。汚れや折れに強く、モジュール数も増えすぎない M にする。 */
const QR_ERROR_CORRECTION = "M" as const;
/** QR の一辺。約 27mm。A4 に印刷しても読み取れる大きさにする。 */
const QR_SIZE_PT = 76;
/** QR パネルの内側の余白。QR の余白（クワイエットゾーン）を兼ねる。 */
const PANEL_PADDING_PT = 8;
/** QR の下に置く告知 URL の文字サイズと行間。 */
const LABEL_FONT_SIZE = 6.2;
const LABEL_LINE_HEIGHT = 7.6;
const LABEL_GAP_PT = 4;
const MAX_LABEL_LINES = 4;

/** 標準フォントで描けるのは ASCII だけなので、和文はパーセント表記へ逃がす。 */
function toAsciiLabel(value: string): string {
  return value.replace(/[^\x20-\x7e]/g, (char) => encodeURIComponent(char));
}

/** 文字幅を測りながら、1 行に収まる範囲で折り返す。 */
function wrapAscii(
  text: string,
  font: PDFFont,
  size: number,
  maxWidth: number,
): string[] {
  const lines: string[] = [];
  let current = "";
  for (const char of text) {
    const next = current + char;
    if (current && font.widthOfTextAtSize(next, size) > maxWidth) {
      lines.push(current);
      current = char;
      continue;
    }
    current = next;
  }
  if (current) lines.push(current);
  return lines;
}

/** 行数が上限を超えたら、最後の行を `...` で詰める。 */
function clampLines(
  lines: string[],
  font: PDFFont,
  size: number,
  maxWidth: number,
): string[] {
  if (lines.length <= MAX_LABEL_LINES) return lines;
  const kept = lines.slice(0, MAX_LABEL_LINES);
  let last = kept[MAX_LABEL_LINES - 1];
  while (last.length > 1 && font.widthOfTextAtSize(`${last}...`, size) > maxWidth) {
    last = last.slice(0, -1);
  }
  kept[MAX_LABEL_LINES - 1] = `${last}...`;
  return kept;
}

/** JPEG / PNG はそのまま、WebP だけ JPEG へ変換して埋め込む。 */
async function embedFlyerImage(
  pdf: PDFDocumentType,
  bytes: Uint8Array,
): Promise<PDFImage> {
  const kind = detectImageKind(bytes);
  if (kind === "jpeg") return pdf.embedJpg(bytes);
  if (kind === "png") return pdf.embedPng(bytes);
  if (kind === "webp") {
    // ネイティブモジュールなので、WebP を扱うときだけ読み込む。
    const { default: sharp } = await import("sharp");
    const jpeg = await sharp(Buffer.from(bytes)).jpeg({ quality: 92 }).toBuffer();
    return pdf.embedJpg(jpeg);
  }
  throw new Error("チラシ画像の形式を判別できませんでした。");
}

/**
 * QR を PDF の矩形で描く。画像にしないので、拡大しても輪郭が甘くならない。
 * 同じ行で連続する暗モジュールは 1 つの矩形へまとめ、命令数を抑える。
 */
function drawQrCode(
  page: PDFPage,
  qrUrl: string,
  x: number,
  y: number,
  sizePt: number,
): void {
  const { modules } = QRCode.create(qrUrl, {
    errorCorrectionLevel: QR_ERROR_CORRECTION,
  });
  const count = modules.size;
  const cell = sizePt / count;
  for (let row = 0; row < count; row += 1) {
    let runStart = -1;
    for (let column = 0; column <= count; column += 1) {
      const dark = column < count && modules.data[row * count + column] === 1;
      if (dark && runStart < 0) runStart = column;
      if (!dark && runStart >= 0) {
        page.drawRectangle({
          x: x + runStart * cell,
          // PDF の原点は左下なので、QR の先頭行が一番上に来るよう反転する。
          y: y + (count - row - 1) * cell,
          width: (column - runStart) * cell,
          height: cell,
          color: QR_DARK,
        });
        runStart = -1;
      }
    }
  }
}

export interface BuildFlyerPdfInput {
  /** 保存済みチラシの画像バイト列。JPEG / PNG / WebP。 */
  image: Uint8Array;
  /** QR に焼き込む告知ページの絶対 URL。 */
  qrUrl: string;
}

/**
 * A4 縦 1 ページの PDF を作る。チラシは縦横比を保ってページ中央へ置き、
 * 右下に白地のパネルを作って QR と告知 URL を描く。
 */
export async function buildFlyerPdf({
  image,
  qrUrl,
}: BuildFlyerPdfInput): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle("チラシ");
  pdf.setCreator("EventKreater");

  const page = pdf.addPage([A4_WIDTH_PT, A4_HEIGHT_PT]);
  const flyer = await embedFlyerImage(pdf, image);
  // 実寸で contain する。アップロード画像の比率が A4 でなくても歪めない。
  const scale = Math.min(A4_WIDTH_PT / flyer.width, A4_HEIGHT_PT / flyer.height);
  const flyerWidth = flyer.width * scale;
  const flyerHeight = flyer.height * scale;
  page.drawImage(flyer, {
    x: (A4_WIDTH_PT - flyerWidth) / 2,
    y: (A4_HEIGHT_PT - flyerHeight) / 2,
    width: flyerWidth,
    height: flyerHeight,
  });

  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const label = clampLines(
    wrapAscii(toAsciiLabel(qrUrl), font, LABEL_FONT_SIZE, QR_SIZE_PT),
    font,
    LABEL_FONT_SIZE,
    QR_SIZE_PT,
  );

  const panelWidth = QR_SIZE_PT + PANEL_PADDING_PT * 2;
  const panelHeight =
    PANEL_PADDING_PT * 2 + QR_SIZE_PT + LABEL_GAP_PT + label.length * LABEL_LINE_HEIGHT;
  const panelX = A4_WIDTH_PT - PAGE_MARGIN_PT - panelWidth;
  const panelY = PAGE_MARGIN_PT;

  page.drawRectangle({
    x: panelX,
    y: panelY,
    width: panelWidth,
    height: panelHeight,
    color: rgb(1, 1, 1),
    borderColor: rgb(0.72, 0.72, 0.72),
    borderWidth: 0.6,
  });
  const qrY = panelY + panelHeight - PANEL_PADDING_PT - QR_SIZE_PT;
  drawQrCode(page, qrUrl, panelX + PANEL_PADDING_PT, qrY, QR_SIZE_PT);

  let baseline = qrY - LABEL_GAP_PT - LABEL_FONT_SIZE;
  for (const line of label) {
    const lineWidth = font.widthOfTextAtSize(line, LABEL_FONT_SIZE);
    page.drawText(line, {
      x: panelX + (panelWidth - lineWidth) / 2,
      y: baseline,
      size: LABEL_FONT_SIZE,
      font,
      color: rgb(0.07, 0.09, 0.15),
    });
    baseline -= LABEL_LINE_HEIGHT;
  }

  return pdf.save();
}
