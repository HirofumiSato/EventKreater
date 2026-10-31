import { describe, expect, it } from "vitest";
import {
  NOTIFICATION_BODY_MAX,
  NOTIFICATION_TITLE_MAX,
  buildRsvpNotification,
  dedupeKeyFor,
  formatUnreadCount,
  notificationRecipientIds,
  participantsPath,
  shouldNotifyRsvp,
} from "@/modules/notifications/lib/rsvp-notification";

/**
 * 参加表明の通知の判定と文面。DB も画面も使わないので、
 * 「どんな変化を知らせるか」をここで固定する。
 */

describe("通知する変化", () => {
  it("新規の出席と参加要望は知らせる", () => {
    expect(shouldNotifyRsvp({ created: true, previousStatus: null, nextStatus: "ATTENDING" })).toBe(
      true,
    );
    expect(shouldNotifyRsvp({ created: true, previousStatus: null, nextStatus: "WAITLISTED" })).toBe(
      true,
    );
  });

  it("欠席からの出席・参加要望は知らせる（席が埋まる動きのため）", () => {
    expect(
      shouldNotifyRsvp({ created: false, previousStatus: "DECLINED", nextStatus: "ATTENDING" }),
    ).toBe(true);
    expect(
      shouldNotifyRsvp({ created: false, previousStatus: "DECLINED", nextStatus: "WAITLISTED" }),
    ).toBe(true);
  });

  it("参加要望から出席へ上がったら知らせる", () => {
    expect(
      shouldNotifyRsvp({ created: false, previousStatus: "WAITLISTED", nextStatus: "ATTENDING" }),
    ).toBe(true);
  });

  it("同じ状態の再送信は知らせない", () => {
    expect(
      shouldNotifyRsvp({ created: false, previousStatus: "ATTENDING", nextStatus: "ATTENDING" }),
    ).toBe(false);
    expect(
      shouldNotifyRsvp({ created: false, previousStatus: "WAITLISTED", nextStatus: "WAITLISTED" }),
    ).toBe(false);
    expect(
      shouldNotifyRsvp({ created: false, previousStatus: "DECLINED", nextStatus: "DECLINED" }),
    ).toBe(false);
  });

  it("出席から参加要望・欠席への変更は知らせない", () => {
    expect(
      shouldNotifyRsvp({ created: false, previousStatus: "ATTENDING", nextStatus: "WAITLISTED" }),
    ).toBe(false);
    expect(
      shouldNotifyRsvp({ created: false, previousStatus: "ATTENDING", nextStatus: "DECLINED" }),
    ).toBe(false);
  });

  it("欠席は、新規でも知らせない", () => {
    expect(shouldNotifyRsvp({ created: true, previousStatus: null, nextStatus: "DECLINED" })).toBe(
      false,
    );
  });
});

describe("通知の文面", () => {
  const base = {
    eventId: "event-1",
    eventTitle: "秋の芋煮会",
    participantName: "佐藤 みのり",
  };

  it("出席は「参加表明がありました」と、誰がどの催しに出るかを書く", () => {
    const content = buildRsvpNotification({ ...base, status: "ATTENDING" });
    expect(content.kind).toBe("RSVP_ATTENDING");
    expect(content.title).toBe("参加表明がありました");
    expect(content.body).toBe("佐藤 みのりさんが「秋の芋煮会」に出席します。");
    expect(content.href).toBe("/organizer/events/event-1/participants");
  });

  it("参加要望は「参加要望が届きました」と、名簿から承認できることを書く", () => {
    const content = buildRsvpNotification({ ...base, status: "WAITLISTED" });
    expect(content.kind).toBe("RSVP_WAITLISTED");
    expect(content.title).toBe("参加要望が届きました");
    expect(content.body).toContain("佐藤 みのりさん");
    expect(content.body).toContain("「秋の芋煮会」");
    expect(content.body).toContain("名簿から承認できます");
    expect(content.href).toBe("/organizer/events/event-1/participants");
  });

  it("名前と催し名が空でも文面が壊れない", () => {
    const content = buildRsvpNotification({
      eventId: "event-1",
      eventTitle: "   ",
      participantName: "  ",
      status: "ATTENDING",
    });
    expect(content.body).toBe("参加者さんが「イベント」に出席します。");
  });

  it("長い催し名でも本文は 300 文字、題は 100 文字に収まる", () => {
    const content = buildRsvpNotification({
      ...base,
      eventTitle: "あ".repeat(400),
      status: "ATTENDING",
    });
    expect(Array.from(content.body)).toHaveLength(NOTIFICATION_BODY_MAX);
    expect(Array.from(content.title).length).toBeLessThanOrEqual(NOTIFICATION_TITLE_MAX);
  });

  it("名簿への行き先は 1 か所で組み立てる", () => {
    expect(participantsPath("abc")).toBe("/organizer/events/abc/participants");
  });
});

describe("二重作成を防ぐ指紋", () => {
  const changedAt = new Date("2026-10-29T10:00:00.000Z");

  it("同じ入力なら同じ 64 文字の hex になる", () => {
    const key = dedupeKeyFor({
      userId: "user-1",
      participantId: "participant-1",
      kind: "RSVP_ATTENDING",
      changedAt,
    });
    expect(key).toMatch(/^[0-9a-f]{64}$/);
    expect(
      dedupeKeyFor({
        userId: "user-1",
        participantId: "participant-1",
        kind: "RSVP_ATTENDING",
        changedAt: "2026-10-29T10:00:00.000Z",
      }),
    ).toBe(key);
  });

  it("受け取る人が違えば別の指紋になる（同じ変化でも 1 人 1 行）", () => {
    const shared = { participantId: "participant-1", kind: "RSVP_ATTENDING" as const, changedAt };
    expect(dedupeKeyFor({ ...shared, userId: "user-1" })).not.toBe(
      dedupeKeyFor({ ...shared, userId: "user-2" }),
    );
  });

  it("種別や時刻が違えば別の指紋になる", () => {
    const shared = { userId: "user-1", participantId: "participant-1" };
    expect(dedupeKeyFor({ ...shared, kind: "RSVP_ATTENDING", changedAt })).not.toBe(
      dedupeKeyFor({ ...shared, kind: "RSVP_WAITLISTED", changedAt }),
    );
    expect(
      dedupeKeyFor({
        ...shared,
        kind: "RSVP_ATTENDING",
        changedAt: new Date("2026-10-29T10:00:01.000Z"),
      }),
    ).not.toBe(dedupeKeyFor({ ...shared, kind: "RSVP_ATTENDING", changedAt }));
  });
});

describe("通知を受け取る会員", () => {
  it("会員の主催者だけを返し、ゲスト主催者は落とす", () => {
    expect(
      notificationRecipientIds(
        [{ userId: "owner" }, { userId: null }, { userId: "cohost" }],
        null,
      ),
    ).toEqual(["owner", "cohost"]);
  });

  it("同じ会員が二重に主催者行を持っても 1 回だけ返す", () => {
    expect(notificationRecipientIds([{ userId: "owner" }, { userId: "owner" }], null)).toEqual([
      "owner",
    ]);
  });

  it("自分の出欠は自分の通知にしない", () => {
    expect(
      notificationRecipientIds([{ userId: "owner" }, { userId: "cohost" }], "owner"),
    ).toEqual(["cohost"]);
  });

  it("ゲスト主催者しかいなければ誰にも作らない", () => {
    expect(notificationRecipientIds([{ userId: null }], null)).toEqual([]);
  });
});

describe("未読数の見た目", () => {
  it("0 件は空文字（バッジの要素ごと出さない）", () => {
    expect(formatUnreadCount(0)).toBe("");
    expect(formatUnreadCount(-1)).toBe("");
    expect(formatUnreadCount(Number.NaN)).toBe("");
  });

  it("1〜9 はその数字", () => {
    expect(formatUnreadCount(1)).toBe("1");
    expect(formatUnreadCount(9)).toBe("9");
  });

  it("10 以上は 9+（桁で幅が変わらない）", () => {
    expect(formatUnreadCount(10)).toBe("9+");
    expect(formatUnreadCount(99)).toBe("9+");
    expect(formatUnreadCount(100)).toBe("9+");
  });
});
