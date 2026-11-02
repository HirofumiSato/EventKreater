import { describe, expect, it } from "vitest";
import {
  AD_TICKET_DAYS,
  REFERRAL_TICKET_LIMIT,
  nextAdGrantAt,
  pickUsableTicket,
  referralGrantSize,
  ticketExpiresAt,
} from "@/modules/billing/lib/tickets";

const DAY_MS = 24 * 60 * 60 * 1000;

function at(iso: string): Date {
  return new Date(iso);
}

describe("使う券を選ぶ", () => {
  it("期限が最も近い券から使う", () => {
    const later = { id: "later", expiresAt: at("2027-02-01T00:00:00.000Z") };
    const sooner = { id: "sooner", expiresAt: at("2026-11-09T00:00:00.000Z") };
    const middle = { id: "middle", expiresAt: at("2026-12-02T00:00:00.000Z") };
    expect(pickUsableTicket([later, sooner, middle], at("2026-11-02T00:00:00.000Z"))).toBe(sooner);
  });

  it("期限切れの券は返さない", () => {
    const now = at("2026-11-02T00:00:00.000Z");
    const expired = { id: "expired", expiresAt: at("2026-11-01T23:59:59.000Z") };
    const alive = { id: "alive", expiresAt: at("2026-11-05T00:00:00.000Z") };
    expect(pickUsableTicket([expired, alive], now)).toBe(alive);
  });

  it("期限ちょうどの券は使えない（境界は開区間）", () => {
    const now = at("2026-11-02T00:00:00.000Z");
    expect(pickUsableTicket([{ expiresAt: now }], now)).toBeNull();
  });

  it("券が無ければ null", () => {
    expect(pickUsableTicket([], at("2026-11-02T00:00:00.000Z"))).toBeNull();
  });

  it("期限が同じなら入力の順を変えない", () => {
    const first = { id: "first", expiresAt: at("2026-12-02T00:00:00.000Z") };
    const second = { id: "second", expiresAt: at("2026-12-02T00:00:00.000Z") };
    expect(pickUsableTicket([first, second], at("2026-11-02T00:00:00.000Z"))).toBe(first);
  });

  it("渡した配列を並べ替えない", () => {
    const ticket = { expiresAt: at("2027-02-01T00:00:00.000Z") };
    const sooner = { expiresAt: at("2026-11-09T00:00:00.000Z") };
    const tickets = [ticket, sooner];
    pickUsableTicket(tickets, at("2026-11-02T00:00:00.000Z"));
    expect(tickets).toEqual([ticket, sooner]);
  });
});

describe("次の動画券を配れる日時", () => {
  it("一度も配っていなければ、いつでも配れる（null）", () => {
    expect(nextAdGrantAt(null, at("2026-11-02T00:00:00.000Z"))).toBeNull();
  });

  it("前回から30日未満なら、その30日後を返す", () => {
    const last = at("2026-11-01T00:00:00.000Z");
    const next = nextAdGrantAt(last, at("2026-11-02T00:00:00.000Z"));
    expect(next?.toISOString()).toBe("2026-12-01T00:00:00.000Z");
  });

  it("前回からちょうど30日なら配れる（null）", () => {
    const last = at("2026-11-01T00:00:00.000Z");
    expect(nextAdGrantAt(last, new Date(last.getTime() + 30 * DAY_MS))).toBeNull();
  });

  it("暦月ではなく30日で数える（1月31日の次は3月2日）", () => {
    const last = at("2026-01-31T00:00:00.000Z");
    const next = nextAdGrantAt(last, at("2026-02-01T00:00:00.000Z"));
    expect(next?.toISOString()).toBe("2026-03-02T00:00:00.000Z");
  });
});

describe("紹介で配る枚数", () => {
  it("まだ受け取っていなければ2枚", () => {
    expect(referralGrantSize(0)).toBe(2);
  });

  it("8枚までなら2枚", () => {
    expect(referralGrantSize(8)).toBe(2);
  });

  it("9枚なら残り1枚だけ配る", () => {
    expect(referralGrantSize(9)).toBe(1);
  });

  it("生涯上限の10枚に達したら配らない", () => {
    expect(referralGrantSize(REFERRAL_TICKET_LIMIT)).toBe(0);
    expect(referralGrantSize(REFERRAL_TICKET_LIMIT + 3)).toBe(0);
  });

  it("数え上げが壊れて負の数でも0として扱う", () => {
    expect(referralGrantSize(-2)).toBe(2);
  });
});

describe("チケットの有効期限", () => {
  it("動画券は発行から7日", () => {
    const issued = at("2026-11-02T09:30:00.000Z");
    expect(ticketExpiresAt("AD", issued).toISOString()).toBe("2026-11-09T09:30:00.000Z");
    expect(AD_TICKET_DAYS).toBe(7);
  });

  it("紹介券は発行から3か月", () => {
    const issued = at("2026-11-02T09:30:00.000Z");
    expect(ticketExpiresAt("REFERRAL", issued).toISOString()).toBe("2027-02-02T09:30:00.000Z");
  });

  it("運営の付与も紹介券と同じ3か月", () => {
    const issued = at("2026-11-02T09:30:00.000Z");
    expect(ticketExpiresAt("MANUAL", issued).toISOString()).toBe("2027-02-02T09:30:00.000Z");
  });

  it("月末をまたぐときは翌月の末日へ丸める", () => {
    expect(ticketExpiresAt("REFERRAL", at("2026-11-30T00:00:00.000Z")).toISOString()).toBe(
      "2027-02-28T00:00:00.000Z",
    );
    expect(ticketExpiresAt("REFERRAL", at("2026-08-31T00:00:00.000Z")).toISOString()).toBe(
      "2026-11-30T00:00:00.000Z",
    );
  });
});
