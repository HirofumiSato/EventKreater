// SMS 中継（Cloudflare Worker）の仕様。staging と本番で同じ handler を使う。
// infra/sms-webhook/src/handler.mjs を直接読み込み、Twilio は `send` で差し替える。
// ネットワークも DB も使わない。

import { afterEach, describe, expect, it, vi } from "vitest";

import { createSmsHandler } from "../../infra/sms-webhook/src/handler.mjs";

const TOKEN = "test-token-0123";
const TOKEN_PATH = `/${TOKEN}`;
const ACCOUNT_SID = "AC_test_sid";
const AUTH_TOKEN = "test-auth-token";
const FROM = "EVENTKRTR";
const BASE_URL = "https://sms-hook-stg.eventkreater.com";
const TO = "+819012345678";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/**
 * `send` を差し替えた handler を作る。既定は「送れた」を返す偽物で、
 * 許可リストは staging の設定（自分の番号だけ）に合わせる。
 */
function createHandler({ send = vi.fn().mockResolvedValue(true), ...overrides } = {}) {
  const handler = createSmsHandler({
    accountSid: ACCOUNT_SID,
    authToken: AUTH_TOKEN,
    from: FROM,
    allowedRecipients: TO,
    webhookToken: TOKEN,
    send,
    ...overrides,
  });
  return { handler, send };
}

/** アプリの deliverSms と同じ形の要求を作る。 */
function post(body, { path = TOKEN_PATH, method = "POST" } = {}) {
  const init = { method };
  if (method !== "GET" && method !== "HEAD") {
    init.headers = { "Content-Type": "application/json" };
    init.body = typeof body === "string" ? body : JSON.stringify(body);
  }
  return new Request(BASE_URL + path, init);
}

function validSms(overrides = {}) {
  return {
    to: TO,
    body: "確認番号は 123456 です。10分以内に入力してください。",
    ...overrides,
  };
}

describe("メソッドとパス", () => {
  it("POST 以外は 405 を返す", async () => {
    const { handler, send } = createHandler();
    for (const method of ["GET", "PUT", "DELETE"]) {
      const response = await handler(post(validSms(), { method }));
      expect(response.status).toBe(405);
    }
    expect(send).not.toHaveBeenCalled();
  });

  it("GET /health は 200 で ok だけを返す", async () => {
    const { handler, send } = createHandler();
    const response = await handler(post(undefined, { path: "/health", method: "GET" }));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
    await expect(response.json()).resolves.toEqual({ ok: true });
    expect(send).not.toHaveBeenCalled();
  });

  it("トークンが違うパスは 404 で、Twilio を呼ばない", async () => {
    const { handler, send } = createHandler();
    const response = await handler(post(validSms(), { path: "/wrong-token" }));
    expect(response.status).toBe(404);
    expect(send).not.toHaveBeenCalled();
  });

  it("トークンが未設定なら、本文が正しくても 404 にする", async () => {
    const { handler, send } = createHandler({ webhookToken: "" });
    const response = await handler(post(validSms(), { path: "/" }));
    expect(response.status).toBe(404);
    expect(send).not.toHaveBeenCalled();
  });
});

describe("本文の検証", () => {
  it("JSON として読めない本文は 400 INVALID_JSON を返す", async () => {
    const { handler, send } = createHandler();
    const response = await handler(post("{"));
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: "INVALID_JSON" });
    expect(send).not.toHaveBeenCalled();
  });

  it("配列や null は 400 INVALID_PAYLOAD を返す", async () => {
    const { handler, send } = createHandler();
    for (const payload of [[], null]) {
      const response = await handler(post(payload));
      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toMatchObject({ error: "INVALID_PAYLOAD" });
    }
    expect(send).not.toHaveBeenCalled();
  });

  it("to が E.164 の形でなければ 400 INVALID_RECIPIENT を返す", async () => {
    const { handler, send } = createHandler();
    for (const to of ["09012345678", "+81-90-1234-5678", "+0123456789", 123]) {
      const response = await handler(post(validSms({ to })));
      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toMatchObject({ error: "INVALID_RECIPIENT" });
    }
    expect(send).not.toHaveBeenCalled();
  });

  it("body が空か空白だけなら 400 MISSING_FIELD を返す", async () => {
    const { handler, send } = createHandler();
    for (const body of ["", "   ", undefined]) {
      const response = await handler(post(validSms({ body })));
      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toMatchObject({ error: "MISSING_FIELD" });
    }
    expect(send).not.toHaveBeenCalled();
  });
});

describe("長さの上限", () => {
  it("body が 1000 文字を超えると 413 TOO_LARGE を返す", async () => {
    const { handler, send } = createHandler();
    const response = await handler(post(validSms({ body: "あ".repeat(1001) })));
    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toMatchObject({ error: "TOO_LARGE" });
    expect(send).not.toHaveBeenCalled();
  });

  it("body が 1000 文字ちょうどなら通す", async () => {
    const { handler } = createHandler();
    const response = await handler(post(validSms({ body: "あ".repeat(1000) })));
    expect(response.status).toBe(202);
  });
});

describe("許可リスト", () => {
  it("完全一致の指定は、その宛先だけを通す", async () => {
    const { handler } = createHandler({ allowedRecipients: `${TO},+819098765432` });
    expect((await handler(post(validSms()))).status).toBe(202);
    expect((await handler(post(validSms({ to: "+819011112222" })))).status).toBe(403);
  });

  it("許可リスト外の宛先は 403 RECIPIENT_NOT_ALLOWED で、Twilio も fetch も呼ばない", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const { handler, send } = createHandler();
    const response = await handler(post(validSms({ to: "+819011112222" })));
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ error: "RECIPIENT_NOT_ALLOWED" });
    expect(send).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("許可リストが空なら、どの宛先も 403 にする", async () => {
    const { handler, send } = createHandler({ allowedRecipients: "" });
    const response = await handler(post(validSms()));
    expect(response.status).toBe(403);
    expect(send).not.toHaveBeenCalled();
  });

  it("`*` は任意の宛先を通す", async () => {
    const { handler, send } = createHandler({ allowedRecipients: "*" });
    const response = await handler(post(validSms({ to: "+819011112222" })));
    expect(response.status).toBe(202);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0].to).toBe("+819011112222");
  });

  it("`*` でも電話番号の検証は効く", async () => {
    const { handler, send } = createHandler({ allowedRecipients: "*" });
    const response = await handler(post(validSms({ to: "09012345678" })));
    expect(response.status).toBe(400);
    expect(send).not.toHaveBeenCalled();
  });
});

describe("Twilio への転送", () => {
  it("成功したら 202 を返し、SID・トークン・From・宛先・本文を渡す", async () => {
    const { handler, send } = createHandler();
    const response = await handler(post(validSms()));

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({ ok: true });
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0]).toMatchObject({
      accountSid: ACCOUNT_SID,
      authToken: AUTH_TOKEN,
      from: FROM,
      to: TO,
      body: "確認番号は 123456 です。10分以内に入力してください。",
    });
  });

  it("打ち切り用の signal を渡す", async () => {
    const { handler, send } = createHandler();
    await handler(post(validSms()));
    expect(send.mock.calls[0][0].signal).toBeInstanceOf(AbortSignal);
  });

  it("Twilio が失敗を返したら 502 UPSTREAM_REJECTED にして、アプリに送信済みと誤認させない", async () => {
    const { handler } = createHandler({ send: vi.fn().mockResolvedValue(false) });
    const response = await handler(post(validSms()));
    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toMatchObject({ error: "UPSTREAM_REJECTED" });
  });

  it("Twilio が例外を投げても 502 UPSTREAM_ERROR にする", async () => {
    const { handler } = createHandler({
      send: vi.fn().mockRejectedValue(new Error("timeout")),
    });
    const response = await handler(post(validSms()));
    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toMatchObject({ error: "UPSTREAM_ERROR" });
  });
});

describe("ログ", () => {
  it("拒否の理由コードだけを出し、宛先を出さない", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { handler } = createHandler();
    await handler(post(validSms({ to: "+819011112222" })));

    const logged = warn.mock.calls.flat().join(" ");
    expect(logged).toContain("RECIPIENT_NOT_ALLOWED");
    expect(logged).not.toContain("+819011112222");
  });

  it("送信に失敗しても、宛先・本文を出さない", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const { handler } = createHandler({
      send: vi.fn().mockRejectedValue(new Error("timeout")),
    });
    await handler(post(validSms()));

    const logged = error.mock.calls.flat().join(" ");
    expect(logged).toContain("UPSTREAM_ERROR");
    expect(logged).not.toContain(TO);
    expect(logged).not.toContain("123456");
    expect(logged).not.toContain("確認番号");
  });
});
