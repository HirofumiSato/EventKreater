import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { clientIp } from "@/modules/auth/lib/cookies";

function request(headers: Record<string, string>): NextRequest {
  return new NextRequest("http://localhost:3012/api/v1/auth/local", { headers });
}

describe("クライアント IP の解決", () => {
  it("Cloudflare の cf-connecting-ip を最優先する", () => {
    const req = request({
      "cf-connecting-ip": "203.0.113.9",
      "x-forwarded-for": "1.2.3.4, 10.0.0.1",
      "x-real-ip": "198.51.100.7",
    });
    expect(clientIp(req)).toBe("203.0.113.9");
  });

  it("x-forwarded-for の先頭を詐称しても、cf-connecting-ip の値になる", () => {
    // ブラウザが x-forwarded-for を送っても、Cloudflare が cf-connecting-ip を
    // 上書きする。先頭を採ると、この 1.1.1.1 で上限を素通りできてしまう。
    const req = request({
      "x-forwarded-for": "1.1.1.1",
      "cf-connecting-ip": "203.0.113.9",
    });
    expect(clientIp(req)).toBe("203.0.113.9");
  });

  it("Cloudflare が無ければ Fly.io の fly-client-ip を使う", () => {
    const req = request({
      "fly-client-ip": "203.0.113.10",
      "x-forwarded-for": "1.2.3.4",
    });
    expect(clientIp(req)).toBe("203.0.113.10");
  });

  it("前段のヘッダが無ければ x-forwarded-for の末尾を採る", () => {
    // 直前のプロキシが末尾に足す。先頭はクライアントが書いた値なので信じない。
    const req = request({ "x-forwarded-for": "1.2.3.4, 203.0.113.11" });
    expect(clientIp(req)).toBe("203.0.113.11");
  });

  it("IPv4 のポート付きと IPv6 の角括弧を落とす", () => {
    expect(clientIp(request({ "cf-connecting-ip": "203.0.113.9:52310" }))).toBe("203.0.113.9");
    expect(clientIp(request({ "cf-connecting-ip": "[2001:db8::1]" }))).toBe("2001:db8::1");
  });

  it("IPv6 をそのまま返す", () => {
    expect(clientIp(request({ "cf-connecting-ip": "2001:db8::1" }))).toBe("2001:db8::1");
  });

  it("IP として読めない値は捨てて次の候補へ進む", () => {
    const req = request({
      "cf-connecting-ip": "unknown",
      "fly-client-ip": "not-an-ip",
      "x-forwarded-for": "1.2.3.4, 203.0.113.12",
    });
    expect(clientIp(req)).toBe("203.0.113.12");
  });

  it("どのヘッダも無ければ null（呼び出し側で local に倒す）", () => {
    expect(clientIp(request({}))).toBeNull();
  });
});
