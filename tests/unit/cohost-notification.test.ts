import { describe, expect, it } from "vitest";
import {
  COHOST_EVENTS_PATH,
  buildCoHostJoinedNotification,
  buildCoHostRemovedNotification,
  cohostEventPath,
  cohostJoinedRecipientIds,
  cohostNoticeDedupeKey,
  cohostRemovedRecipientIds,
} from "@/modules/notifications/lib/cohost-notification";
import {
  NOTIFICATION_BODY_MAX,
  NOTIFICATION_TITLE_MAX,
} from "@/modules/notifications/lib/rsvp-notification";

/**
 * 共同主催の受諾・解除の通知。DB も画面も使わないので、
 * 「誰に」「何を書くか」「二重に作らない指紋」をここで固定する。
 */

describe("共同主催が加わった通知", () => {
  it("受諾者と催し名を本文に書き、幹事パネルがある編集画面へ送る", () => {
    const content = buildCoHostJoinedNotification({
      eventId: "event-1",
      eventTitle: "秋の芋煮会",
      actorName: "佐藤 みのり",
    });

    expect(content.kind).toBe("COHOST_JOINED");
    expect(content.title).toBe("共同主催が加わりました");
    expect(content.body).toBe(
      "佐藤 みのりさんが「秋の芋煮会」の共同主催・幹事に加わりました。",
    );
    expect(content.href).toBe("/organizer/events/event-1/edit");
  });

  it("名前と催し名が空でも文面が壊れない", () => {
    const content = buildCoHostJoinedNotification({
      eventId: "event-1",
      eventTitle: "   ",
      actorName: "  ",
    });

    expect(content.body).toBe(
      "新しい共同主催が「イベント」の共同主催・幹事に加わりました。",
    );
  });

  it("長い名前と催し名でも題は 100 文字、本文は 300 文字に収まる", () => {
    const content = buildCoHostJoinedNotification({
      eventId: "event-1",
      eventTitle: "あ".repeat(400),
      actorName: "い".repeat(400),
    });

    expect(Array.from(content.body)).toHaveLength(NOTIFICATION_BODY_MAX);
    expect(Array.from(content.title).length).toBeLessThanOrEqual(NOTIFICATION_TITLE_MAX);
  });

  it("編集画面の行き先は 1 か所で組み立てる", () => {
    expect(cohostEventPath("abc")).toBe("/organizer/events/abc/edit");
  });
});

describe("共同主催が外れた通知", () => {
  it("外れた本人には、自分の名前を三人称で書かずに外れたことだけを伝える", () => {
    const content = buildCoHostRemovedNotification({
      eventTitle: "秋の芋煮会",
      removedName: "佐藤 みのり",
      self: true,
    });

    expect(content.kind).toBe("COHOST_REMOVED");
    expect(content.title).toBe("共同主催が外れました");
    expect(content.body).toBe("「秋の芋煮会」の共同主催・幹事から外れました。");
    expect(content.body).not.toContain("佐藤 みのり");
    expect(content.href).toBe(COHOST_EVENTS_PATH);
  });

  it("残る幹事には、誰が外れたかを添える", () => {
    const content = buildCoHostRemovedNotification({
      eventTitle: "秋の芋煮会",
      removedName: "佐藤 みのり",
      self: false,
    });

    expect(content.body).toBe(
      "佐藤 みのりさんが「秋の芋煮会」の共同主催・幹事から外れました。",
    );
  });

  it("名前と催し名が空でも文面が壊れない", () => {
    const content = buildCoHostRemovedNotification({
      eventTitle: "   ",
      removedName: "  ",
      self: false,
    });

    expect(content.body).toBe(
      "共同主催が「イベント」の共同主催・幹事から外れました。",
    );
  });

  it("長い名前と催し名でも題は 100 文字、本文は 300 文字に収まる", () => {
    const content = buildCoHostRemovedNotification({
      eventTitle: "あ".repeat(400),
      removedName: "い".repeat(400),
      self: false,
    });

    expect(Array.from(content.body)).toHaveLength(NOTIFICATION_BODY_MAX);
    expect(Array.from(content.title).length).toBeLessThanOrEqual(NOTIFICATION_TITLE_MAX);
  });
});

describe("受諾を知らせる会員", () => {
  it("会員の幹事だけを返し、ゲスト幹事と受諾した本人は落とす", () => {
    expect(
      cohostJoinedRecipientIds(
        [
          { userId: "owner" },
          { userId: null },
          { userId: "actor" },
          { userId: "cohost" },
        ],
        "actor",
      ),
    ).toEqual(["owner", "cohost"]);
  });

  it("同じ会員が二重に幹事行を持っても 1 回だけ返す", () => {
    expect(
      cohostJoinedRecipientIds(
        [{ userId: "owner" }, { userId: "owner" }, { userId: "cohost" }],
        "actor",
      ),
    ).toEqual(["owner", "cohost"]);
  });

  it("会員の幹事が受諾者しかいなければ誰にも作らない", () => {
    expect(cohostJoinedRecipientIds([{ userId: "actor" }, { userId: null }], "actor")).toEqual([]);
  });
});

describe("解除を知らせる会員", () => {
  it("外れた本人と、行為者以外の残る幹事を返す", () => {
    expect(
      cohostRemovedRecipientIds({
        remainingOrganizers: [
          { userId: "owner" },
          { userId: "cohost" },
          { userId: null },
          { userId: "cohost" },
        ],
        removedUserId: "removed",
        actorUserId: "owner",
      }),
    ).toEqual(["removed", "cohost"]);
  });

  it("ゲスト幹事が外れたときは、残る会員の幹事にだけ返す", () => {
    expect(
      cohostRemovedRecipientIds({
        remainingOrganizers: [{ userId: "owner" }, { userId: "cohost" }],
        removedUserId: null,
        actorUserId: "owner",
      }),
    ).toEqual(["cohost"]);
  });

  it("外れた本人が行為者でも、自分へは作らない", () => {
    expect(
      cohostRemovedRecipientIds({
        remainingOrganizers: [{ userId: "cohost" }],
        removedUserId: "actor",
        actorUserId: "actor",
      }),
    ).toEqual(["cohost"]);
  });
});

describe("二重作成を防ぐ指紋", () => {
  const base = {
    kind: "COHOST_JOINED" as const,
    userId: "user-1",
    organizerId: "organizer-1",
  };

  it("同じ入力なら同じ 64 文字の hex になる", () => {
    const key = cohostNoticeDedupeKey(base);
    expect(key).toMatch(/^[0-9a-f]{64}$/);
    expect(cohostNoticeDedupeKey({ ...base })).toBe(key);
  });

  it("受け取る人が違えば別の指紋になる", () => {
    expect(cohostNoticeDedupeKey({ ...base, userId: "user-2" })).not.toBe(
      cohostNoticeDedupeKey(base),
    );
  });

  it("幹事の行が違えば別の指紋になる（解除して再招待されても衝突しない）", () => {
    expect(cohostNoticeDedupeKey({ ...base, organizerId: "organizer-2" })).not.toBe(
      cohostNoticeDedupeKey(base),
    );
  });

  it("受諾と解除で別の指紋になる", () => {
    expect(cohostNoticeDedupeKey({ ...base, kind: "COHOST_REMOVED" })).not.toBe(
      cohostNoticeDedupeKey(base),
    );
  });
});
