import { describe, expect, it } from "vitest";
import { SITE } from "@/lib/site";
import {
  type Viewer,
  siteNavConfig,
  userMenuConfig,
  viewerInitial,
  viewerRole,
  viewerRoleLabel,
} from "@/lib/site-nav";

const participant: Viewer = { name: "参加者", isOrganizer: false, platformRole: "MEMBER" };
const organizer: Viewer = { name: "主催者", isOrganizer: true, platformRole: "MEMBER" };
const admin: Viewer = { name: "管理者", isOrganizer: true, platformRole: "ADMIN" };

describe("共通ヘッダーの並び（ログイン状態別）", () => {
  it("未ログインはサービス紹介と 2 つの入口を出し、作成をバーに常時出す", () => {
    const config = siteNavConfig("/service", null);

    expect(config.links).toEqual([SITE.nav.service, SITE.nav.participantLogin]);
    expect(config.primary).toEqual(SITE.nav.createEvent);
    expect(config.action).toEqual(SITE.nav.organizerLogin);
  });

  it("参加者は参加者の機能だけを並べ、主催者として使う切り替えを 1 本だけ持つ", () => {
    const config = siteNavConfig("/participant", participant);

    expect(config.links).toEqual([
      SITE.nav.participantHome,
      SITE.nav.participantCalendar,
      SITE.nav.participantHistory,
    ]);
    // 作成の入口は参加者画面に出さない。
    expect(config.primary).toBeUndefined();
    expect(config.action).toEqual(SITE.nav.organizerSwitch);
  });

  it("主催者でも参加者画面では参加者の並びにし、主催者マイページだけを足す", () => {
    const config = siteNavConfig("/participant/calendar", organizer);

    expect(config.links).toEqual([
      SITE.nav.participantHome,
      SITE.nav.participantCalendar,
      SITE.nav.participantHistory,
      SITE.nav.mypage,
    ]);
    expect(config.primary).toBeUndefined();
    // 主催者画面への行き来は向こう側の 1 本に任せる。
    expect(config.action).toBeUndefined();
  });

  it("主催者画面はバーのナビを持たず、作成と参加者への切り替えだけを持つ", () => {
    const config = siteNavConfig("/organizer/events", organizer);

    // 行き先はヘッダー直下の節（OrganizerTabs）が持つ。バーには重ねない。
    expect(config.links).toEqual([]);
    expect(config.primary).toEqual(SITE.nav.createEvent);
    expect(config.action).toEqual(SITE.nav.participantSwitch);
  });

  it("アカウントは頭文字のメニューが持つので、どの並びにも入れない", () => {
    for (const pathname of ["/participant", "/participant/calendar", "/organizer/events", "/account"]) {
      expect(siteNavConfig(pathname, organizer).links).not.toContainEqual(SITE.nav.account);
      expect(siteNavConfig(pathname, participant).links).not.toContainEqual(SITE.nav.account);
    }
  });

  it("主催者画面は /mypage と /invitations も同じ並びにする", () => {
    for (const pathname of ["/mypage", "/invitations", "/invitations/abc"]) {
      expect(siteNavConfig(pathname, organizer)).toEqual(siteNavConfig("/organizer/events", organizer));
    }
  });

  it("主催者画面の判定はパスの区切りまで見る", () => {
    expect(siteNavConfig("/organizerlike", organizer)).toEqual(siteNavConfig("/participant", organizer));
    expect(siteNavConfig("/mypagelike", organizer)).toEqual(siteNavConfig("/participant", organizer));
  });

  it("アカウントはバーのナビを持たず、戻り先は本文に任せる", () => {
    for (const viewer of [participant, organizer]) {
      const config = siteNavConfig("/account", viewer);

      expect(config.links).toEqual([]);
      expect(config.primary).toBeUndefined();
      expect(config.action).toBeUndefined();
    }
  });

  it("管理者は管理コンソールだけを出し、主催者・参加者の機能を並べない", () => {
    for (const pathname of ["/service", "/participant", "/organizer/events", "/account"]) {
      const config = siteNavConfig(pathname, admin);

      expect(config.links).toEqual([SITE.nav.console]);
      expect(config.primary).toBeUndefined();
      expect(config.action).toBeUndefined();
    }
  });

  it("管理コンソールへの導線は管理者にだけ出す", () => {
    for (const viewer of [null, participant, organizer]) {
      const config = siteNavConfig("/service", viewer);

      expect(config.links).not.toContainEqual(SITE.nav.console);
    }
  });
});

/**
 * 頭文字の札を押して開くメニュー。節（`OrganizerTabs`）と同じ行き先を重ねない。
 */
describe("頭文字のメニューの並び", () => {
  it("参加者はアカウントだけを持ち、通知と下書きは出さない", () => {
    expect(userMenuConfig("/participant", participant)).toEqual([SITE.nav.account]);
  });

  it("主催者でも参加者画面では通知だけを足す", () => {
    expect(userMenuConfig("/participant", organizer)).toEqual([
      SITE.nav.notifications,
      SITE.nav.account,
    ]);
  });

  it("節がある主催者画面では、マイページを重ねず下書きを受ける", () => {
    for (const pathname of [
      "/mypage",
      "/organizer/events",
      "/organizer/calendar",
      "/organizer/revenue",
      "/organizer/profile",
    ]) {
      const links = userMenuConfig(pathname, organizer);

      expect(links).toEqual([
        SITE.nav.participantSwitch,
        SITE.nav.notifications,
        SITE.nav.organizerDrafts,
        SITE.nav.account,
      ]);
      // ホーム（`/mypage`）は節が持つ。メニューに同じ行き先を重ねない。
      expect(links).not.toContainEqual(SITE.nav.mypage);
    }
  });

  it("節を出さない作業画面では、マイページへの入口をメニューに残す", () => {
    for (const pathname of [
      "/organizer/events/new",
      "/organizer/events/abc/edit",
      "/organizer/events/abc/preview",
      "/organizer/events/abc/receipts/xyz",
      "/invitations/abc",
    ]) {
      expect(userMenuConfig(pathname, organizer)).toEqual([
        SITE.nav.participantSwitch,
        SITE.nav.mypage,
        SITE.nav.notifications,
        SITE.nav.organizerDrafts,
        SITE.nav.account,
      ]);
    }
  });

  it("管理者は会員向けの行き先を持たない", () => {
    for (const pathname of ["/service", "/participant", "/organizer/events", "/mypage"]) {
      expect(userMenuConfig(pathname, admin)).toEqual([]);
    }
  });
});

describe("ログイン状態の札", () => {
  it("管理者は管理者として示す", () => {
    expect(viewerRole("/organizer/events", admin)).toBe("admin");
    expect(viewerRoleLabel("admin")).toBe("管理者");
  });

  it("主催者でも参加者画面では参加者として示す", () => {
    expect(viewerRole("/organizer/events", organizer)).toBe("organizer");
    expect(viewerRole("/participant", organizer)).toBe("participant");
    expect(viewerRoleLabel("participant")).toBe("参加者");
    expect(viewerRoleLabel("organizer")).toBe("主催者");
  });

  it("主催イベントを持たない会員は参加者として示す", () => {
    expect(viewerRole("/participant", participant)).toBe("participant");
    expect(viewerRole("/account", participant)).toBe("participant");
  });

  it("頭文字は 1 文字に切り、空の名前でも崩れない", () => {
    expect(viewerInitial("博文")).toBe("博");
    expect(viewerInitial("  Anna  ")).toBe("A");
    expect(viewerInitial("")).toBe("?");
    expect(viewerInitial("   ")).toBe("?");
    // 絵文字を 2 つに割らない。
    expect(viewerInitial("🎪 フェス")).toBe("🎪");
  });
});
