// モックを配る、最小の静的サーバー。
//
//   npm run mock:serve          # http://127.0.0.1:4321/style-guide/mock-index.html
//   MOCK_PORT=4322 npm run mock:serve
//
// モックは `npm run mock:sync` が製品の DOM から書き出す生成物で、CSS と画像は
// `style-guide/assets/` に閉じている。本来はファイルを直接開いても動くが、
// IDE の内蔵ブラウザなど、file:// のままではページ間のリンクが辿れない環境がある。
// その差を吸収するために、同じものを HTTP でも出せるようにしておく。
//
// 部品見本（style-guide/index.html）は `style-guide.css` と `../src/styles/` を
// 相対参照するので、ルートはリポジトリ直下にする。
//
// 配るのは style-guide/ と public/ と src/styles/ の静的ファイルだけ。.env や
// prisma/ のような、モックが見ないものは置かない。拡張子で弾く。

import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const entry = "/style-guide/mock-index.html";

// モックが実際に参照する範囲。ここを広げると、関係のないファイルまで外に出る。
const PREFIXES = ["style-guide/", "public/", "src/styles/"];

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

/**
 * モックを配るサーバーを立てる。常駐ハーネス（scripts/lib/ui-harness.mjs）からも使えるよう、
 * 起動そのものを関数にしてある。CLI（npm run mock:serve）は下の末尾で呼ぶ。
 *
 * 戻り値の close() は、立てた本人が呼ぶ。
 */
export function startMockServer({ port = Number(process.env.MOCK_PORT ?? 4321), host = "127.0.0.1" } = {}) {
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

  return new Promise((resolve, reject) => {
    server.once("error", (error) => {
      if (error.code === "EADDRINUSE") {
        reject(new Error(`ポート ${port} は使用中です。MOCK_PORT で別の番号を指定してください。`));
      } else {
        reject(new Error(`サーバーを起動できません: ${error.message}`));
      }
    });
    server.listen(port, host, () => {
      resolve({
        port,
        host,
        url: `http://${host}:${port}`,
        close: () =>
          new Promise((done) => {
            server.close(() => done());
            server.closeAllConnections?.();
          }),
      });
    });
  });
}

// CLI として起動されたときだけ、案内を出す。
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const port = Number(process.env.MOCK_PORT ?? 4321);
  try {
    await startMockServer({ port });
  } catch (error) {
    console.error(error.message);
    console.error(`  MOCK_PORT=${port + 1} npm run mock:serve`);
    process.exit(1);
  }
  console.log(`モック: http://127.0.0.1:${port}${entry}`);
  console.log(`一覧:   http://127.0.0.1:${port}/style-guide/mock-index.html`);
  console.log("停止は Ctrl+C。");
}
