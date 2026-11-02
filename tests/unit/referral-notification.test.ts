import { describe, expect, it } from "vitest";
import { formatDateSlashJa } from "@/lib/format";
import {
  REFERRAL_NOTIFICATION_HREF,
  buildReferralNotification,
  referralNoticeDedupeKey,
} from "@/modules/notifications/lib/referral-notification";
import {
  NOTIFICATION_BODY_MAX,
  NOTIFICATION_TITLE_MAX,
} from "@/modules/notifications/lib/rsvp-notification";

/**
 * 紹介でチケットが配られたときの通知。DB も画面も使わないので、
 * 何を書くか・押した先・二重に作らない鍵をここで固定する。
 */

describe("紹介の通知の文面", () => {
  const expiresAt = new Date("2027-02-03T00:00:00.000Z");

  it("配った枚数と期限を 1 文に収める", () => {
    const content = buildReferralNotification({
      name: "山田 花子",
      count: 2,
      expiresAt,
    });

    expect(content.kind).toBe("REFERRAL_GRANTED");
    expect(content.title).toBe("紹介でチケットが届きました");
    expect(content.body).toBe("山田 花子さんがはじめて公開しました。チケット2枚（2027/02/03 まで）。");
  });

  it("生涯上限の端数で 1 枚だけ配るときも、1 枚と書く", () => {
    const content = buildReferralNotification({ name: "山田 花子", count: 1, expiresAt });
    expect(content.body).toContain("チケット1枚");
  });

  it("枚数が 0 以下でも、文面は 1 枚として壊れない", () => {
    expect(buildReferralNotification({ name: "山田", count: 0, expiresAt }).body).toContain(
      "チケット1枚",
    );
    expect(buildReferralNotification({ name: "山田", count: -3, expiresAt }).body).toContain(
      "チケット1枚",
    );
  });

  it("名前が空でも文面が壊れない", () => {
    const content = buildReferralNotification({ name: "   ", count: 2, expiresAt });
    expect(content.body).toBe("紹介された方がはじめて公開しました。チケット2枚（2027/02/03 まで）。");
  });

  it("長い名前でも題は 100 文字、本文は 300 文字に収まる", () => {
    const content = buildReferralNotification({
      name: "あ".repeat(400),
      count: 2,
      expiresAt,
    });
    expect(Array.from(content.title).length).toBeLessThanOrEqual(NOTIFICATION_TITLE_MAX);
    expect(Array.from(content.body)).toHaveLength(NOTIFICATION_BODY_MAX);
  });

  it("押した先はマイページ（催しに紐づかないため）", () => {
    expect(REFERRAL_NOTIFICATION_HREF).toBe("/mypage");
    expect(buildReferralNotification({ name: "山田", count: 2, expiresAt }).href).toBe("/mypage");
  });

  it("期限は日本時間の日付で書く（時差で 1 日ずれない）", () => {
    // UTC の 15:00 は日本時間では翌日。保存した瞬間の日付で読めるようにする。
    expect(formatDateSlashJa(new Date("2027-02-03T15:00:00.000Z"))).toBe("2027/02/04");
    expect(formatDateSlashJa("2027-02-03T00:00:00.000Z")).toBe("2027/02/03");
  });
});

describe("紹介の通知の指紋", () => {
  it("同じ人が紹介されたら、何度呼んでも同じ 64 文字の hex", () => {
    const key = referralNoticeDedupeKey("user-1");
    expect(key).toMatch(/^[0-9a-f]{64}$/);
    expect(referralNoticeDedupeKey("user-1")).toBe(key);
  });

  it("紹介された人が違えば、別の指紋になる", () => {
    expect(referralNoticeDedupeKey("user-1")).not.toBe(referralNoticeDedupeKey("user-2"));
  });

  it("参加表明の指紋とは混ざらない（同じ会員でも別の行になる）", () => {
    // 種別を前置しているので、紹介の指紋が参加表明の指紋と同じ値になることはない。
    expect(referralNoticeDedupeKey("user-1")).not.toBe(referralNoticeDedupeKey("user-1\n"));
  });
});
