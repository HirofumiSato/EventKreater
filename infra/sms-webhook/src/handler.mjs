// SMS 中継（Cloudflare Worker）の中核。staging と本番で同じ実装を使い、
// 違いは wrangler の設定（アプリ名・ホスト名）だけにする。
//
// アプリの `src/lib/sms.ts` は SMS_WEBHOOK_URL に { to, body } を
// 認証ヘッダなしで POST するだけなので、ここで受けて Twilio へ転送する。
// send を差し替えられる形にして、テストではネットワークを一切使わない。

const TWILIO_API_BASE = "https://api.twilio.com/2010-04-01/Accounts";
const HEALTH_PATH = "/health";
// 確認コードは 30 文字ほど。SMS の 1 セグメントに収まる範囲だけを通す。
const MAX_BODY_LENGTH = 1000;
const SEND_TIMEOUT_MS = 5000;

// E.164 だけを通す。`toE164` の出力（+ と 8〜15 桁）に合わせ、
// 先頭 0 の国内形式や区切り入りの番号を Twilio まで運ばない。
const PHONE_PATTERN = /^\+[1-9]\d{7,14}$/;

function jsonResponse(status, payload) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

/**
 * 許可リストを配列にする。`,` 区切りで、前後の空白は落とす。
 * `*` は「全宛先を許可」の目印として、そのまま配列に残す。
 *
 * メール中継と違い、`@example.com` のようなドメイン指定は無い。
 * 電話番号は完全一致だけで比べる。
 */
function normalizeAllowedRecipients(value) {
  const entries = Array.isArray(value) ? value : String(value ?? "").split(",");
  return entries.map((entry) => String(entry).trim()).filter(Boolean);
}

function isAllowedRecipient(to, allowedRecipients) {
  // 空の許可リストは従来どおり全拒否。`*` を書いたときだけ全宛先を通す。
  if (allowedRecipients.includes("*")) return true;
  return allowedRecipients.includes(to);
}

/**
 * Twilio のエラー本文から `code` だけを取り出す。読めなければ空文字。
 * 本文には宛先やメッセージが入っているので、ここで捨てて `code` 以外は返さない。
 */
async function upstreamErrorCode(response) {
  if (typeof response.json !== "function") return "";
  try {
    const payload = await response.json();
    const code = payload?.code;
    if (typeof code === "number" || typeof code === "string") return `_CODE_${code}`;
  } catch {
    // JSON でない応答もある。ステータスだけで十分に切り分けられる。
  }
  return "";
}

/**
 * 既定の送信。Twilio の Messages API を叩いて、201/202 だったときだけ true を返す。
 * テストでは `send` を注入してここを通さない。
 */
async function sendWithTwilio({ accountSid, authToken, from, to, body, signal }) {
  const response = await fetch(`${TWILIO_API_BASE}/${accountSid}/Messages.json`, {
    method: "POST",
    headers: {
      // Basic 認証はユーザー名が Account SID、パスワードが Auth Token。
      Authorization: `Basic ${btoa(`${accountSid}:${authToken}`)}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ To: to, From: from, Body: body }).toString(),
    signal,
  });
  if (response.status !== 201 && response.status !== 202) {
    // 原因を切り分けるため、上流のステータスと Twilio の `code` だけを残す。
    // 宛先・本文（6 桁コード）は絶対に出さない。
    // 401 は SID / トークン、21211 は宛先の形、21606 は From の権限。
    const code = await upstreamErrorCode(response);
    console.error(`[sms-webhook] UPSTREAM_STATUS_${response.status}${code}`);
    return false;
  }
  return true;
}

/**
 * `fetch(request)` として呼べる関数を作る。
 *
 * 判定順は「メソッド → パスのトークン → 本文 → 形 → 長さ → 許可リスト → 転送」。
 * `GET /health` だけはメソッドの判定より先に返す（監視用で、本文は ok だけ）。
 *
 * 失敗を返すのは意図的で、アプリは 2xx 以外を "RECORDED" に落として
 * `[sms]` ログを出す。ここで握りつぶすと未送信に気づけなくなる。
 */
export function createSmsHandler({
  accountSid,
  authToken,
  from,
  allowedRecipients,
  webhookToken,
  send = sendWithTwilio,
} = {}) {
  const allowed = normalizeAllowedRecipients(allowedRecipients);
  // 認証ヘッダを付けられないので、トークンはパスで受ける。
  const expectedPath = webhookToken ? `/${webhookToken}` : null;

  // ログは理由コードだけ。宛先・本文（6 桁コード）は絶対に出さない。
  function reject(status, code) {
    if (status >= 500) console.error(`[sms-webhook] ${code}`);
    else console.warn(`[sms-webhook] ${code}`);
    return jsonResponse(status, { ok: false, error: code });
  }

  return async function handle(request) {
    const url = new URL(request.url);

    // Access を付けないため誰でも叩ける。返すのは ok だけにして内部は見せない。
    if (request.method === "GET" && url.pathname === HEALTH_PATH) {
      return jsonResponse(200, { ok: true });
    }

    if (request.method !== "POST") return reject(405, "METHOD_NOT_ALLOWED");

    if (!expectedPath || url.pathname !== expectedPath) return reject(404, "NOT_FOUND");

    let payload;
    try {
      payload = await request.json();
    } catch {
      return reject(400, "INVALID_JSON");
    }
    if (payload === null || typeof payload !== "object" || Array.isArray(payload)) {
      return reject(400, "INVALID_PAYLOAD");
    }

    const to = typeof payload.to === "string" ? payload.to.trim() : "";
    const body = typeof payload.body === "string" ? payload.body : "";

    if (!PHONE_PATTERN.test(to)) return reject(400, "INVALID_RECIPIENT");
    if (!body.trim()) return reject(400, "MISSING_FIELD");

    if (body.length > MAX_BODY_LENGTH) return reject(413, "TOO_LARGE");

    if (!isAllowedRecipient(to, allowed)) return reject(403, "RECIPIENT_NOT_ALLOWED");

    try {
      const sent = await send({
        accountSid,
        authToken,
        from,
        to,
        body,
        // deliverSms にタイムアウトが無く登録リクエストが await で待つので、ここで打ち切る。
        signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
      });
      if (!sent) return reject(502, "UPSTREAM_REJECTED");
    } catch {
      // 時間切れ・例外も同じ扱い。成功だけ 202 を返す。
      return reject(502, "UPSTREAM_ERROR");
    }

    return jsonResponse(202, { ok: true });
  };
}
