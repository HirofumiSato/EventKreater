// 主催者マイページの操作ガイドの 7 枚。
//
// 画面（`MyPageGuideTour`）はこの定義をそのまま描くので、順番・対象・開く印が
// 変わるとガイドの意味が変わる。文言も含めてここで固定する。
//
// イベント作成のガイド（`tests/unit/event-guide-steps.test.ts`）とは別の配列である。
// 枚数も対象の画面も違うため、片方に枚を足してももう片方の「3 / 7」がずれない。

import { describe, expect, it } from "vitest";
import {
  MYPAGE_GUIDE_ACTION_COPY,
  MYPAGE_GUIDE_STEPS,
  myPageGuideIndex,
  myPageGuideStep,
  type MyPageGuideKey,
} from "@/modules/organizers/lib/tour/steps";

describe("7 枚の並び", () => {
  it("紹介から始まり、右上の「使い方」で終わる", () => {
    expect(MYPAGE_GUIDE_STEPS.map((step) => step.key)).toEqual([
      "referral",
      "notifications",
      "notificationLink",
      "organizerEvents",
      "inviteCoHost",
      "organizerProfile",
      "final",
    ]);
  });

  it("画面をまたぐ招待と公開プロフだけ /organizer/events を指す", () => {
    expect(MYPAGE_GUIDE_STEPS.map((step) => step.path)).toEqual([
      "/mypage",
      "/mypage",
      "/mypage",
      "/mypage",
      "/organizer/events",
      "/organizer/events",
      "/mypage",
    ]);
  });

  it("どの枚にも対象のセレクタがある（穴の無い枚を作らない）", () => {
    for (const step of MYPAGE_GUIDE_STEPS) {
      expect(step.targets.length).toBeGreaterThan(0);
      for (const selector of step.targets) expect(selector).not.toBe("");
    }
  });

  it("7 枚の対象を、画面に足した目印か既にある要素で指す", () => {
    expect(myPageGuideStep("referral").targets).toEqual([
      '[data-guide-target="mypage-referral"]',
    ]);
    expect(myPageGuideStep("notifications").targets).toEqual(["#notifications"]);
    expect(myPageGuideStep("notificationLink").targets).toEqual([
      '#site-user-menu a[href="/notifications"]',
    ]);
    expect(myPageGuideStep("organizerEvents").targets).toEqual([
      'nav.subnav a[href="/organizer/events"]',
    ]);
    expect(myPageGuideStep("inviteCoHost").targets).toEqual([
      'article.event-card:first-of-type [data-guide-target="invite-cohost"]',
    ]);
    expect(myPageGuideStep("organizerProfile").targets).toEqual([
      'nav.subnav a[href="/organizer/profile"]',
    ]);
    expect(myPageGuideStep("final").targets).toEqual([
      '[data-guide-target="mypage-guide"]',
    ]);
  });

  it("紹介の枚は、もらえる枚数と上限を 1 か所で伝える", () => {
    const copy = myPageGuideStep("referral").copy;

    expect(copy.title).toBe("紹介リンクはここからコピー");
    expect(copy.body).toContain("無料チケットが2枚");
    expect(copy.note).toBe("1アカウント当たり上限10枚");
  });

  it("新着と通知一覧を、本文でつなぐ（メニューの中にあることを伝える）", () => {
    expect(myPageGuideStep("notifications").copy.title).toBe("新着がここに出ます");
    expect(myPageGuideStep("notificationLink").copy.body).toContain("右上のメニュー");
  });

  it("招待の枚は、札の「その他の操作」から開くことを伝える", () => {
    const copy = myPageGuideStep("inviteCoHost").copy;

    expect(copy.title).toBe("共同主催・幹事を招待できます");
    expect(copy.body).toContain("その他の操作");
  });
});

describe("最終枚", () => {
  it("1 つだけで、右上の「使い方」を指す", () => {
    const finals = MYPAGE_GUIDE_STEPS.filter((step) => step.final);

    expect(finals).toHaveLength(1);
    expect(finals[0].key).toBe("final");
    expect(finals[0].targets).toEqual(['[data-guide-target="mypage-guide"]']);
  });

  it("見出しは「ここから操作は再度確認できます」", () => {
    expect(myPageGuideStep("final").copy.title).toBe("ここから操作は再度確認できます");
    expect(myPageGuideStep("final").copy.body).toContain("使い方");
  });

  it("操作は「わかった」だけで、「次回から表示しない」のチェックを置かない", () => {
    expect(MYPAGE_GUIDE_ACTION_COPY.done).toBe("わかった");
    expect(MYPAGE_GUIDE_ACTION_COPY).not.toHaveProperty("dismiss");
    expect(myPageGuideStep("final").copy.note).toBeUndefined();
  });
});

describe("文言の置き方", () => {
  it("すべての枚に見出しと、本文か箇条書きがある", () => {
    for (const step of MYPAGE_GUIDE_STEPS) {
      expect(step.copy.title.length).toBeGreaterThan(0);
      const hasBody = (step.copy.body?.length ?? 0) > 0;
      const hasBullets = (step.copy.bullets?.length ?? 0) > 0;
      expect(hasBody || hasBullets).toBe(true);
    }
  });

  it("本文と箇条書きは同じ枚に並べない（同じことを 2 回言わない）", () => {
    for (const step of MYPAGE_GUIDE_STEPS) {
      const hasBody = (step.copy.body?.length ?? 0) > 0;
      const hasBullets = (step.copy.bullets?.length ?? 0) > 0;
      expect(hasBody && hasBullets).toBe(false);
    }
  });
});

describe("開く印", () => {
  it("右上のユーザーメニューを開くのは通知一覧の枚だけ", () => {
    const opened = MYPAGE_GUIDE_STEPS.filter((step) => step.openUserMenu);

    expect(opened.map((step) => step.key)).toEqual(["notificationLink"]);
  });

  it("札の「その他の操作」を開くのは招待の枚だけ", () => {
    const opened = MYPAGE_GUIDE_STEPS.filter((step) => step.openDetails);

    expect(opened.map((step) => step.key)).toEqual(["inviteCoHost"]);
  });
});

describe("操作の文言", () => {
  it("戻る・次へ・スキップ・閉じる・わかったを 1 か所に持つ", () => {
    expect(MYPAGE_GUIDE_ACTION_COPY).toEqual({
      back: "戻る",
      next: "次へ",
      skip: "ガイドをスキップ",
      close: "ガイドを閉じる",
      done: "わかった",
    });
  });
});

describe("キーから枚を引く", () => {
  it("キーから 0 始まりの位置を引ける（再開に使う）", () => {
    expect(MYPAGE_GUIDE_STEPS.map((step) => myPageGuideIndex(step.key))).toEqual([
      0, 1, 2, 3, 4, 5, 6,
    ]);
    expect(myPageGuideIndex("inviteCoHost")).toBe(4);
    expect(myPageGuideIndex("final")).toBe(6);
  });

  it("知らないキーは黙って別の枚を返さず、例外にする", () => {
    expect(() => myPageGuideStep("unknown" as MyPageGuideKey)).toThrow(
      "unknown mypage guide step: unknown",
    );
    expect(() => myPageGuideIndex("unknown" as MyPageGuideKey)).toThrow(
      "unknown mypage guide step: unknown",
    );
  });
});
