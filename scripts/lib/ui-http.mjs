// 検証スクリプト専用の、最小の HTTP 取得。
//
// `fetch` は接続を使い回す（keep-alive）。便利な代わりに、取得が終わっても
// 接続がしばらく残り、Node のプロセスが終わりにくい。検証は「1 回のコマンドで
// 終わる」ことが大事なので、使い捨ての接続だけを使う（`agent: false`）。
//
// 依存を増やさないため、node:http / node:https をそのまま使う。

import http from "node:http";
import https from "node:https";

/**
 * URL を 1 回取得する。接続は毎回作り、応答を読み終えたら閉じる。
 *
 * `follow` を指定すると、その回数だけ 3xx を追う（Next の middleware が
 * 未ログインを /auth/login へ送るため、先読みでは追う必要がある）。
 */
export function httpGet(
  url,
  { headers = {}, timeoutMs = 30000, follow = 0, method = "GET" } = {},
) {
  const once = (target, remaining) =>
    new Promise((resolve, reject) => {
      const client = target.protocol === "https:" ? https : http;
      const request = client.request(
        target,
        { method, headers, agent: false },
        (response) => {
          const chunks = [];
          response.on("data", (chunk) => chunks.push(chunk));
          response.on("end", () => {
            const status = response.statusCode ?? 0;
            const location = response.headers.location;
            if (follow > 0 && remaining > 0 && status >= 300 && status < 400 && location) {
              resolve(once(new URL(location, target), remaining - 1));
              return;
            }
            resolve({
              status,
              headers: response.headers,
              body: Buffer.concat(chunks).toString("utf8"),
            });
          });
          response.on("error", reject);
        },
      );
      request.setTimeout(timeoutMs, () => {
        request.destroy(new Error(`応答がありません: ${target.href}`));
      });
      request.on("error", reject);
      request.end();
    });

  return once(new URL(url), follow);
}

/** JSON を取る。取れなければ null（起動待ち）。 */
export async function httpGetJson(url, options = {}) {
  try {
    const response = await httpGet(url, options);
    if (response.status < 200 || response.status >= 300) return null;
    return JSON.parse(response.body);
  } catch {
    return null;
  }
}
