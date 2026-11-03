// staging のメール中継（Cloudflare Worker）の中核。
//
// アプリの `src/lib/mail.ts` は MAIL_WEBHOOK_URL に { to, subject, body } を
// 認証ヘッダなしで POST するだけなので、ここで受けて Resend へ転送する。
// send を差し替えられる形にして、テストではネットワークを一切使わない。

const RESEND_ENDPOINT = "https://api.resend.com/emails";
const HEALTH_PATH = "/health";
const SUBJECT_PREFIX = "[stg] ";
const MAX_SUBJECT_LENGTH = 200;
const MAX_BODY_LENGTH = 10000;
const SEND_TIMEOUT_MS = 5000;

// ドメインに点を要求する。`user@example` のような打ち間違いを Resend まで運ばない。
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function jsonResponse(status, payload) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

/**
 * 許可リストを小文字の配列にする。
 * `@example.com` の形はドメイン全体、それ以外は完全一致で比べる。
 */
function normalizeAllowedRecipients(value) {
  const entries = Array.isArray(value) ? value : String(value ?? "").split(",");
  return entries.map((entry) => String(entry).trim().toLowerCase()).filter(Boolean);
}

function isAllowedRecipient(to, allowedRecipients) {
  const target = to.toLowerCase();
  return allowedRecipients.some((entry) =>
    entry.startsWith("@") ? target.endsWith(entry) : target === entry,
  );
}

/**
 * 既定の送信。Resend の /emails を叩いて、2xx だったときだけ true を返す。
 * テストでは `send` を注入してここを通さない。
 */
async function sendWithResend({ apiKey, from, to, subject, text, signal }) {
  const response = await fetch(RESEND_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from, to: [to], subject, text }),
    signal,
  });
  if (!response.ok) {
    // 原因を切り分けるため、上流のステータスだけを残す。宛先・件名・本文は出さない。
    // 401 は鍵、403 は鍵の権限、422 は from / to かドメイン認証、429 は送信数の上限。
    console.error(`[mail-webhook] UPSTREAM_STATUS_${response.status}`);
  }
  return response.ok;
}

/**
 * `fetch(request)` として呼べる関数を作る。
 *
 * 判定順は「メソッド → パスのトークン → 本文 → 長さ → 許可リスト → 転送」。
 * `GET /health` だけはメソッドの判定より先に返す（監視用で、本文は ok だけ）。
 *
 * 失敗を返すのは意図的で、アプリは 2xx 以外を "RECORDED" に落として
 * `[mail]` ログを出す。ここで握りつぶすと未送信に気づけなくなる。
 */
export function createMailHandler({
  resendApiKey,
  from,
  allowedRecipients,
  webhookToken,
  send = sendWithResend,
} = {}) {
  const allowed = normalizeAllowedRecipients(allowedRecipients);
  // 認証ヘッダを付けられないので、トークンはパスで受ける。
  const expectedPath = webhookToken ? `/${webhookToken}` : null;

  // ログは理由コードだけ。宛先・件名・本文（確認 URL と 6 桁コード）は絶対に出さない。
  function reject(status, code) {
    if (status >= 500) console.error(`[mail-webhook] ${code}`);
    else console.warn(`[mail-webhook] ${code}`);
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
    const subject = typeof payload.subject === "string" ? payload.subject.trim() : "";
    const body = typeof payload.body === "string" ? payload.body : "";

    if (!EMAIL_PATTERN.test(to)) return reject(400, "INVALID_RECIPIENT");
    if (!subject || !body.trim()) return reject(400, "MISSING_FIELD");

    if (subject.length > MAX_SUBJECT_LENGTH || body.length > MAX_BODY_LENGTH) {
      return reject(413, "TOO_LARGE");
    }

    if (!isAllowedRecipient(to, allowed)) return reject(403, "RECIPIENT_NOT_ALLOWED");

    try {
      const sent = await send({
        apiKey: resendApiKey,
        from,
        to,
        subject: SUBJECT_PREFIX + subject,
        text: body,
        // deliverMail にタイムアウトが無く登録リクエストが await で待つので、ここで打ち切る。
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
