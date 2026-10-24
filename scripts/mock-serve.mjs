// 装飾モックを配る、最小の静的サーバー。
//
//   npm run mock:serve          # http://127.0.0.1:4321/style-guide/mock-index.html
//   MOCK_PORT=4322 npm run mock:serve
//
// モックは相対パスだけで閉じているので、本来はファイルを直接開いても動く。
// ただし IDE の内蔵ブラウザなど、file:// のままではページ間のリンクが辿れない環境がある。
// その差を吸収するために、同じものを HTTP でも出せるようにしておく。
//
// ルートはリポジトリ直下。モックは ../src/app/attendance.css と ../public/samples/*.jpg を
// 相対参照するので、style-guide を根にすると CSS と画像が 404 になる。
//
// 配るのは style-guide/ と public/ と src/app/ の静的ファイルだけ。.env や
// prisma/ のような、モックが見ないものは置かない。拡張子で弾く。

import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const port = Number(process.env.MOCK_PORT ?? 4321);
const host = "127.0.0.1";
const entry = "/style-guide/mock-index.html";

// モックが実際に参照する範囲。ここを広げると、関係のないファイルまで外に出る。
const PREFIXES = ["style-guide/", "public/", "src/app/"];

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
};

/** URL をファイルの位置に変える。外に出る指定は null。 */
function resolve(urlPath) {
  let decoded;
  try {
    decoded = decodeURIComponent(urlPath);
  } catch {
    // 壊れた % エスケープ。ここで 400 にする。
    return null;
  }
  if (decoded.includes("\0")) return null;

  // Windows は \ も区切りとして扱う。posix の正規化では潰れず、そのまま
  // path.join に渡すと "..\package.json" が親へ出る。入口で断る。
  if (decoded.includes("\\")) return null;

  // path.posix で正規化してから、root からの相対に直す。
  // ../ で外へ出る指定は、この時点で ".." が先頭に残るので弾ける。
  const relative = path.posix.normalize(decoded).replace(/^\/+/, "");
  if (relative.startsWith("..")) return null;

  const file = path.join(root, ...relative.split("/"));
  if (!file.startsWith(root + path.sep)) return null;

  const normalized = relative.replace(/\\/g, "/");
  if (!PREFIXES.some((prefix) => normalized.startsWith(prefix))) return null;

  const ext = path.extname(file).toLowerCase();
  if (!TYPES[ext]) return null;

  return { file, ext, relative: normalized };
}

function send(res, status, body, headers = {}) {
  res.writeHead(status, {
    // モックは直しながら見る。リロードで必ず今の内容が出るようにする。
    "Cache-Control": "no-store",
    ...headers,
  });
  res.end(body);
}

const server = http.createServer((req, res) => {
  if (req.method !== "GET" && req.method !== "HEAD") {
    send(res, 405, "GET のみ", { Allow: "GET, HEAD" });
    return;
  }

  const urlPath = (req.url ?? "/").split("?")[0].split("#")[0];

  // 根を開いたら一覧へ送る。URL を短く覚えられるように。
  if (urlPath === "/" || urlPath === "/style-guide" || urlPath === "/style-guide/") {
    send(res, 302, "", { Location: entry });
    return;
  }

  const target = resolve(urlPath);
  if (!target) {
    send(res, 404, "見つかりません", { "Content-Type": "text/plain; charset=utf-8" });
    return;
  }

  let stat;
  try {
    stat = fs.statSync(target.file);
  } catch {
    send(res, 404, "見つかりません", { "Content-Type": "text/plain; charset=utf-8" });
    return;
  }

  // ディレクトリなら index.html に解決する。
  const file = stat.isDirectory() ? path.join(target.file, "index.html") : target.file;
  if (stat.isDirectory() && !fs.existsSync(file)) {
    send(res, 404, "見つかりません", { "Content-Type": "text/plain; charset=utf-8" });
    return;
  }

  let body;
  try {
    body = fs.readFileSync(file);
  } catch {
    send(res, 404, "見つかりません", { "Content-Type": "text/plain; charset=utf-8" });
    return;
  }

  const ext = path.extname(file).toLowerCase();
  send(res, 200, req.method === "HEAD" ? "" : body, {
    "Content-Type": TYPES[ext] ?? "application/octet-stream",
    "Content-Length": String(body.length),
  });
});

server.on("error", (error) => {
  if (error.code === "EADDRINUSE") {
    console.error(`ポート ${port} は使用中です。`);
    console.error("既にモックのサーバーが動いていないか確認するか、MOCK_PORT で別の番号を指定してください。");
    console.error(`  MOCK_PORT=${port + 1} npm run mock:serve`);
  } else {
    console.error(`サーバーを起動できません: ${error.message}`);
  }
  process.exit(1);
});

server.listen(port, host, () => {
  console.log(`装飾モック: http://${host}:${port}${entry}`);
  console.log(`一覧:       http://${host}:${port}/style-guide/mock-index.html`);
  console.log(`比較:       http://${host}:${port}/style-guide/mock-compare.html`);
  console.log("停止は Ctrl+C。");
});
