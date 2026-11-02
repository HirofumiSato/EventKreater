import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import {
  REFERRAL_ALPHABET,
  generateReferralCode,
  isReferralCodeShape,
  isSelfReferral,
  referralReasonKey,
  referralUrl,
} from "@/modules/billing/lib/referral-code";
import { REFERRAL_CODE_LENGTH, readReferralCookie } from "@/modules/auth/lib/referral-cookie";

describe("紹介コードの形", () => {
  it("8文字の英数で作る", () => {
    const code = generateReferralCode();
    expect(code).toHaveLength(REFERRAL_CODE_LENGTH);
    expect(code).toMatch(/^[0-9A-Za-z]{8}$/);
  });

  it("読み間違えやすい 0・O・1・l を使わない", () => {
    for (const banned of ["0", "O", "1", "l"]) {
      expect(REFERRAL_ALPHABET).not.toContain(banned);
    }
    const codes = Array.from({ length: 50 }, () => generateReferralCode()).join("");
    expect(codes).not.toMatch(/[0O1l]/);
  });

  it("作るたびに違うコードになる（50回で重複しない）", () => {
    const codes = new Set(Array.from({ length: 50 }, () => generateReferralCode()));
    expect(codes.size).toBe(50);
  });

  it("受け付けるのは8文字の英数だけ", () => {
    expect(isReferralCodeShape("x7Kd2mQp")).toBe(true);
    expect(isReferralCodeShape("x7Kd2mQ")).toBe(false);
    expect(isReferralCodeShape("x7Kd2mQpp")).toBe(false);
    expect(isReferralCodeShape("x7Kd2-Qp")).toBe(false);
    expect(isReferralCodeShape("")).toBe(false);
  });
});

describe("紹介の判定", () => {
  it("自分で自分を紹介したら、配らない", () => {
    expect(isSelfReferral("u1", "u1")).toBe(true);
  });

  it("別の会員なら、配る", () => {
    expect(isSelfReferral("u1", "u2")).toBe(false);
  });

  it("紹介者が見つからなければ、配らない", () => {
    expect(isSelfReferral(null, "u2")).toBe(false);
  });
});

describe("紹介券の理由キー", () => {
  it("同じ人が何度公開しても、同じ番号になる", () => {
    expect(referralReasonKey("u1", 0)).toBe("referral:u1:0");
    expect(referralReasonKey("u1", 1)).toBe("referral:u1:1");
  });

  it("人が違えば別のキーになる", () => {
    expect(referralReasonKey("u1", 0)).not.toBe(referralReasonKey("u2", 0));
  });
});

describe("紹介リンク", () => {
  it("登録の入口を指す", () => {
    expect(referralUrl("https://example.com", "x7Kd2mQp")).toBe(
      "https://example.com/auth/register?ref=x7Kd2mQp",
    );
  });

  it("末尾のスラッシュが重ならない", () => {
    expect(referralUrl("https://example.com/", "x7Kd2mQp")).toBe(
      "https://example.com/auth/register?ref=x7Kd2mQp",
    );
  });
});

describe("Cookie から読む紹介コード", () => {
  function request(cookie?: string): NextRequest {
    return new NextRequest("http://localhost/api/v1/auth/local", {
      headers: cookie ? { cookie } : {},
    });
  }

  it("8文字のコードを返す", () => {
    expect(readReferralCookie(request("ref_code=x7Kd2mQp"))).toBe("x7Kd2mQp");
  });

  it("Cookie が無ければ null", () => {
    expect(readReferralCookie(request())).toBeNull();
    expect(readReferralCookie(request("other=1"))).toBeNull();
  });

  it("長さが足りない値と、記号まじりの値は null", () => {
    expect(readReferralCookie(request("ref_code=x7Kd2m"))).toBeNull();
  });

  it("英数だけに削っても8文字そろえば通す", () => {
    expect(readReferralCookie(request("ref_code=x7Kd-2mQp"))).toBe("x7Kd2mQp");
  });
});
