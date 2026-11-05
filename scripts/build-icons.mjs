// サイトのアイコン（favicon・apple-touch-icon）を作り直す。
//
//   npm run icons
//
// `public/icons/app-icon-source.jpg`（1024px 角の元画像）から、ブラウザが読む
// 大きさだけを書き出す。元画像は、アプリのアイコンとして作られた暗い角丸の
// タイルに、グラデーションの「K」が光って載っている絵。
//
// そのまま縮小すると、タイルの余白とタイルの縁が入って「K」が小さくなり、
// タブの 16px では読めなくなる。そこで、光っている「K」の外接矩形を中心に
// 560px 角で切り出してから縮小する。切り出しの位置は下の LOGO が持つ
// （元画像を差し替えたら、この 4 つの数を測り直す）。
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";

const ROOT = process.cwd();
const SOURCE = path.join(ROOT, "public", "icons", "app-icon-source.jpg");
const ICON_DIR = path.join(ROOT, "public", "icons");
const FAVICON = path.join(ROOT, "public", "favicon.ico");

// 光っている「K」の外接矩形（元画像 1024px 角の座標）。
const LOGO = { left: 307, top: 272, right: 737, bottom: 745 };
// 切り出す正方形の一辺。光の滲みが切れない程度に余白を残す。
const CROP_SIDE = 560;
// ブラウザと iOS が読む大きさ。`layout.tsx` の `metadata.icons` と同じ並び。
const PNG_SIZES = [16, 32, 48, 96, 192];
const APPLE_SIZE = 180;
// .ico に入れる大きさ。16 はタブ、32 はタスクバー、48 は大きい表示。
const ICO_SIZES = [16, 32, 48];

function squareCrop(side) {
  const cx = (LOGO.left + LOGO.right) / 2;
  const cy = (LOGO.top + LOGO.bottom) / 2;
  return {
    left: Math.round(cx - side / 2),
    top: Math.round(cy - side / 2),
    width: side,
    height: side,
  };
}

/**
 * 小さくするほど線が細って薄れるので、16 と 32 だけ最後に輪郭を持ち上げる。
 * 強くかけると光の滲みに白い縁が付くため、控えめにする。
 */
async function render(master, size) {
  let pipeline = sharp(master).resize(size, size, { kernel: "lanczos3" });
  if (size <= 32) pipeline = pipeline.sharpen({ sigma: 0.6, m1: 0.6, m2: 0.4 });
  return pipeline.png({ compressionLevel: 9 }).toBuffer();
}

/**
 * ICO は PNG をそのまま包める（Vista 以降と主要ブラウザが読む）。
 * 幅と高さが 256 のときだけ 0 を書く決まりなので、そこだけ分ける。
 */
function buildIco(entries) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(entries.length, 4);

  const table = Buffer.alloc(16 * entries.length);
  let offset = header.length + table.length;
  entries.forEach(({ size, data }, index) => {
    const at = index * 16;
    table.writeUInt8(size >= 256 ? 0 : size, at);
    table.writeUInt8(size >= 256 ? 0 : size, at + 1);
    table.writeUInt8(0, at + 2);
    table.writeUInt8(0, at + 3);
    table.writeUInt16LE(1, at + 4);
    table.writeUInt16LE(32, at + 6);
    table.writeUInt32LE(data.length, at + 8);
    table.writeUInt32LE(offset, at + 12);
    offset += data.length;
  });

  return Buffer.concat([header, table, ...entries.map((entry) => entry.data)]);
}

async function main() {
  if (!existsSync(SOURCE)) {
    throw new Error(`元画像がありません: ${path.relative(ROOT, SOURCE)}`);
  }

  const source = await readFile(SOURCE);
  const meta = await sharp(source).metadata();
  if (meta.width !== 1024 || meta.height !== 1024) {
    throw new Error(
      `元画像は 1024px 角を前提にしています（いまは ${meta.width}x${meta.height}）。` +
        "差し替えたなら、このスクリプトの LOGO と CROP_SIDE も測り直してください。",
    );
  }

  const master = await sharp(source).extract(squareCrop(CROP_SIDE)).png().toBuffer();
  await mkdir(ICON_DIR, { recursive: true });

  for (const size of PNG_SIZES) {
    const data = await render(master, size);
    await writeFile(path.join(ICON_DIR, `icon-${size}.png`), data);
  }

  const apple = await render(master, APPLE_SIZE);
  await writeFile(path.join(ICON_DIR, `apple-icon-${APPLE_SIZE}.png`), apple);

  const icoEntries = [];
  for (const size of ICO_SIZES) {
    icoEntries.push({ size, data: await render(master, size) });
  }
  await writeFile(FAVICON, buildIco(icoEntries));

  console.log(`元画像 ${meta.width}x${meta.height} → ${CROP_SIDE}px 角を切り出し`);
  console.log(`public/icons/icon-{${PNG_SIZES.join(",")}}.png`);
  console.log(`public/icons/apple-icon-${APPLE_SIZE}.png`);
  console.log(`public/favicon.ico (${ICO_SIZES.join("/")})`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
