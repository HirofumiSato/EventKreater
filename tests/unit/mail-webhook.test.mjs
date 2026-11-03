// staging のメール中継（Cloudflare Worker）の仕様。
// infra/mail-webhook/src/handler.mjs を直接読み込み、Resend は `send` で差し替える。
// ネットワークも DB も使わない。

import { afterEach, describe, expect, it, vi } from "vitest";

import { createMailHandler } from "../../infra/mail-webhook/src/handler.mjs";

const TOKEN = "test-token-0123";
const TOKEN_PATH = `/${TOKEN}`;
const FROM = "no-reply@send-stg.eventkreater.com";
const BASE_URL = "https://mail-hook-stg.eventkreater.com";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** `send` を差し替えた handler を作る。既定は「送れた」を返す偽物。 */
function createHandler({ send = vi.fn().mockResolvedValue(true), ...overrides } = {}) {
  const handler = createMailHandler({
    resendApiKey: "re_test_key",
    from: FROM,
    allowedRecipients: "@example.com,ops@example.net",
    webhookToken: TOKEN,
    send,
    ...overrides,
  });
  return { handler, send };
}

/** アプリの deliverMail と同じ形の要求を作る。 */
function post(body, { path = TOKEN_PATH, method = "POST" } = {}) {
  const init = { method };
  if (method !== "GET" && method !== "HEAD") {
    init.headers = { "Content-Type": "application/json" };
    init.body = typeof body === "string" ? body : JSON.stringify(body);
  }
  return new Request(BASE_URL + path, init);
}

function validMail(overrides = {}) {
  return {
    to: "user@example.com",
    subject: "メールアドレスの確認",
    body: "確認 URL: https://example.test/verify?token=abc",
    ...overrides,
  };
}

describe("メソッドとパス", () => {
  it("POST 以外は 405 を返す", async () => {
    const { handler, send } = createHandler();
    const response = await handler(post(validMail(), { method: "GET" }));
    expect(response.status).toBe(405);
    expect(send).not.toHaveBeenCalled();
  });

  it("GET /health は 200 で ok だけを返す", async () => {
    const { handler } = createHandler();
    const response = await handler(post(undefined, { path: "/health", method: "GET" }));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
    await expect(response.json()).resolves.toEqual({ ok: true });
  });

  it("トークンが違うパスは 404 で、Resend を呼ばない", async () => {
    const { handler, send } = createHandler();
    const response = await handler(post(validMail(), { path: "/wrong-token" }));
    expect(response.status).toBe(404);
    expect(send).not.toHaveBeenCalled();
  });

  it("トークンが未設定なら、本文が正しくても 404 にする", async () => {
    const { handler, send } = createHandler({ webhookToken: "" });
    const response = await handler(post(validMail(), { path: "/" }));
    expect(response.status).toBe(404);
    expect(send).not.toHaveBeenCalled();
  });
});

describe("本文の検証", () => {
  it("JSON として読めない本文は 400 を返す", async () => {
    const { handler, send } = createHandler();
    const response = await handler(post("{"));
    expect(response.status).toBe(400);
    expect(send).not.toHaveBeenCalled();
  });

  it("to がメールアドレスの形でなければ 400 を返す", async () => {
    const { handler, send } = createHandler();
    for (const to of ["user", "user@example", "user @example.com", 123]) {
      const response = await handler(post(validMail({ to })));
      expect(response.status).toBe(400);
    }
    expect(send).not.toHaveBeenCalled();
  });

  it("subject か body が文字列でなければ 400 を返す", async () => {
    const { handler } = createHandler();
    expect((await handler(post(validMail({ subject: 123 })))).status).toBe(400);
    expect((await handler(post(validMail({ body: { text: "x" } })))).status).toBe(400);
  });

  it("subject か body が空なら 400 を返す", async () => {
    const { handler } = createHandler();
    expect((await handler(post(validMail({ subject: "" })))).status).toBe(400);
    expect((await handler(post(validMail({ body: "   " })))).status).toBe(400);
  });
});

describe("長さの上限", () => {
  it("subject が 200 文字を超えると 413 を返す", async () => {
    const { handler, send } = createHandler();
    const response = await handler(post(validMail({ subject: "あ".repeat(201) })));
    expect(response.status).toBe(413);
    expect(send).not.toHaveBeenCalled();
  });

  it("subject が 200 文字ちょうどなら通す", async () => {
    const { handler } = createHandler();
    const response = await handler(post(validMail({ subject: "あ".repeat(200) })));
    expect(response.status).toBe(202);
  });

  it("body が 10000 文字を超えると 413 を返す", async () => {
    const { handler, send } = createHandler();
    const response = await handler(post(validMail({ body: "あ".repeat(10001) })));
    expect(response.status).toBe(413);
    expect(send).not.toHaveBeenCalled();
  });
});

describe("許可リスト", () => {
  it("ドメイン全体の指定は、そのドメインの宛先を通す", async () => {
    const { handler } = createHandler();
    const response = await handler(post(validMail({ to: "anyone@example.com" })));
    expect(response.status).toBe(202);
  });

  it("完全一致の指定は、その宛先だけを通す", async () => {
    const { handler } = createHandler();
    expect((await handler(post(validMail({ to: "ops@example.net" })))).status).toBe(202);
    expect((await handler(post(validMail({ to: "other@example.net" })))).status).toBe(403);
  });

  it("大文字と小文字を区別しない", async () => {
    const { handler } = createHandler();
    const response = await handler(post(validMail({ to: "Ops@Example.NET" })));
    expect(response.status).toBe(202);
  });

  it("許可リスト外の宛先は 403 で、Resend も fetch も呼ばない", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const { handler, send } = createHandler();
    const response = await handler(post(validMail({ to: "nobody@other.test" })));
    expect(response.status).toBe(403);
    expect(send).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("許可リストが空なら、どの宛先も 403 にする", async () => {
    const { handler, send } = createHandler({ allowedRecipients: "" });
    const response = await handler(post(validMail()));
    expect(response.status).toBe(403);
    expect(send).not.toHaveBeenCalled();
  });
});

describe("Resend への転送", () => {
  it("成功したら 202 を返し、[stg] 付きの件名と text で渡す", async () => {
    const { handler, send } = createHandler();
    const response = await handler(post(validMail()));

    expect(response.status).toBe(202);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0]).toMatchObject({
      apiKey: "re_test_key",
      from: FROM,
      to: "user@example.com",
      subject: "[stg] メールアドレスの確認",
      text: "確認 URL: https://example.test/verify?token=abc",
    });
  });

  it("打ち切り用の signal を渡す", async () => {
    const { handler, send } = createHandler();
    await handler(post(validMail()));
    expect(send.mock.calls[0][0].signal).toBeInstanceOf(AbortSignal);
  });

  it("Resend が失敗を返したら 502 にして、アプリに送信済みと誤認させない", async () => {
    const { handler } = createHandler({ send: vi.fn().mockResolvedValue(false) });
    const response = await handler(post(validMail()));
    expect(response.status).toBe(502);
  });

  it("Resend が例外を投げても 502 にする", async () => {
    const { handler } = createHandler({
      send: vi.fn().mockRejectedValue(new Error("timeout")),
    });
    const response = await handler(post(validMail()));
    expect(response.status).toBe(502);
  });
});

describe("ログ", () => {
  it("拒否の理由コードだけを出し、宛先を出さない", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { handler } = createHandler();
    await handler(post(validMail({ to: "nobody@other.test" })));

    const logged = warn.mock.calls.flat().join(" ");
    expect(logged).toContain("RECIPIENT_NOT_ALLOWED");
    expect(logged).not.toContain("nobody@other.test");
  });

  it("送信に失敗しても、宛先・件名・本文を出さない", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const { handler } = createHandler({
      send: vi.fn().mockRejectedValue(new Error("timeout")),
    });
    await handler(post(validMail()));

    const logged = error.mock.calls.flat().join(" ");
    expect(logged).toContain("UPSTREAM_ERROR");
    expect(logged).not.toContain("user@example.com");
    expect(logged).not.toContain("メールアドレスの確認");
    expect(logged).not.toContain("verify?token=abc");
  });
});
