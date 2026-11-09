import { describe, expect, it } from "vitest";
import { SITE } from "@/lib/site";
import {
  type Viewer,
  accountReturnTarget,
  siteNavConfig,
  userMenuConfig,
  viewerInitial,
  viewerRole,
  viewerRoleCaption,
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

  it("参加者画面のバーはナビも作成も持たず、頭文字の札だけになる", () => {
    const config = siteNavConfig("/participant", participant);

    // 行き先はヘッダー直下の節（ParticipantTabs）が持つ。バーには重ねない。
    expect(config.links).toEqual([]);
    // 作成の入口は参加者画面に出さない。
    expect(config.primary).toBeUndefined();
    // 「主催者として使う」もバーには置かず、頭文字のメニューが受ける。
    expect(config.action).toBeUndefined();
  });

  it("主催者でも参加者画面では参加者と同じバーになり、主催者マイページはメニューが受ける", () => {
    for (const pathname of ["/participant", "/participant/calendar", "/participant/history"]) {
      const config = siteNavConfig(pathname, organizer);

      expect(config.links).toEqual([]);
      expect(config.primary).toBeUndefined();
      expect(config.action).toBeUndefined();
    }
  });

  it("主催者画面のバーはナビも作成も持たず、頭文字の札だけになる", () => {
    const config = siteNavConfig("/organizer/events", organizer);

    // 行き先はヘッダー直下の節（OrganizerTabs）が持つ。バーには重ねない。
    expect(config.links).toEqual([]);
    // 「作る」もバーには置かない。主催一覧の下帯と、マイページ・売上・カレンダーの本文が受ける。
    expect(config.primary).toBeUndefined();
    // 切り替えは主催者以外が主催者エリアを開いたときの戻り道。主催者には出さない。
    expect(config.action).toEqual(SITE.nav.participantSwitch);
  });

  it("アカウントは頭文字のメニューが持つので、どの並びにも入れない", () => {
    for (const pathname of ["/participant", "/participant/calendar", "/organizer/events", "/account"]) {
      expect(siteNavConfig(pathname, organizer).links).not.toContainEqual(SITE.nav.account);
      expect(siteNavConfig(pathname, participant).links).not.toContainEqual(SITE.nav.account);
    }
  });

  it("主催者画面は /mypage と /invitations も同じ並びにする", () => {
    for (const pathname of ["/mypage", "/notifications", "/invitations", "/invitations/abc"]) {
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
 * 頭文字の札を押して開くメニュー。並びは 1 本で固定し、画面で変わるのは
 * 「主催者の行き先を出すか」だけにする。節（`OrganizerTabs`）と同じ行き先も
 * 消さない（現在地は `aria-current` が示す）。
 */
describe("頭文字のメニューの並び", () => {
  it("主催者は、どの画面でも同じ並びになる", () => {
    const expected = [
      SITE.nav.participantSwitch,
      SITE.nav.mypage,
      SITE.nav.notifications,
      SITE.nav.organizerDrafts,
      SITE.nav.plan,
      SITE.nav.account,
    ];

    for (const pathname of [
      "/participant",
      "/participant/calendar",
      "/service",
      "/account",
      "/mypage",
      "/notifications",
      "/organizer/events",
      "/organizer/calendar",
      "/organizer/revenue",
      "/organizer/profile",
      "/organizer/events/new",
      "/organizer/events/abc/edit",
      "/organizer/events/abc/preview",
      "/invitations/abc",
    ]) {
      expect(userMenuConfig(pathname, organizer)).toEqual(expected);
    }
  });

  it("参加者はアカウントと、主催者として使う切り替えだけを持つ", () => {
    for (const pathname of ["/participant", "/participant/history", "/service", "/account"]) {
      expect(userMenuConfig(pathname, participant)).toEqual([
        SITE.nav.organizerSwitch,
        SITE.nav.account,
      ]);
    }
  });

  it("催し 0 件の会員でも、主催者画面では主催者の並びになる（通知だけ出さない）", () => {
    const expected = [
      SITE.nav.participantSwitch,
      SITE.nav.mypage,
      SITE.nav.organizerDrafts,
      SITE.nav.plan,
      SITE.nav.account,
    ];

    for (const pathname of [
      "/mypage",
      "/organizer/events",
      "/organizer/events/new",
      "/invitations/abc",
    ]) {
      expect(userMenuConfig(pathname, participant)).toEqual(expected);
    }
    // 通知は主催者にしか作られない。催し 0 件のあいだは出さない。
    expect(userMenuConfig("/mypage", participant)).not.toContainEqual(SITE.nav.notifications);
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

  it("主催イベントを持たない会員でも、主催者画面では主催者として示す", () => {
    // 登録直後の主催者は必ず催し 0 件になる。主催者エリアでは主催者として示す。
    for (const pathname of ["/mypage", "/organizer/events", "/notifications", "/invitations/abc"]) {
      expect(viewerRole(pathname, participant)).toBe("organizer");
      expect(viewerRoleCaption(viewerRole(pathname, participant))).toBe("主催者アカウント");
    }
  });

  it("ブランド名の下は、いま使っているアカウントの種類を出す", () => {
    // ヘッダーの色だけに頼らず、ブランド名の下でどの立場かを読ませる。
    expect(viewerRoleCaption("participant")).toBe("参加者アカウント");
    expect(viewerRoleCaption("organizer")).toBe("主催者アカウント");
    expect(viewerRoleCaption("admin")).toBe("管理者アカウント");
  });

  it("頭文字は 1 文字に切り、空の名前でも崩れない", () => {
    expect(viewerInitial("春子")).toBe("春");
    expect(viewerInitial("  Anna  ")).toBe("A");
    expect(viewerInitial("")).toBe("?");
    expect(viewerInitial("   ")).toBe("?");
    // 絵文字を 2 つに割らない。
    expect(viewerInitial("🎪 フェス")).toBe("🎪");
  });
});

/**
 * アカウント設定（`/account` 配下）は主催者と参加者が同じ画面を使う。
 * 立場は会員の属性（`isOrganizer`）で決め、本文の戻り先も同じ材料から決める。
 * 片方だけ別の規則にすると、主催者なのに「参加者アカウント」と出る。
 */
describe("アカウント設定のヘッダーの立場", () => {
  it("主催者がアカウント設定を開いても主催者として示す", () => {
    expect(viewerRole("/account", organizer)).toBe("organizer");
    expect(viewerRoleCaption(viewerRole("/account", organizer))).toBe("主催者アカウント");
  });

  it("アカウント設定の配下（メール確認）も同じ立場で示す", () => {
    expect(viewerRole("/account/email/verify", organizer)).toBe("organizer");
    expect(viewerRoleCaption(viewerRole("/account/email/verify", organizer))).toBe(
      "主催者アカウント",
    );
  });

  it("参加者はアカウント設定でも参加者として示す", () => {
    expect(viewerRole("/account", participant)).toBe("participant");
    expect(viewerRoleCaption(viewerRole("/account", participant))).toBe("参加者アカウント");
  });

  it("アカウント設定の判定はパスの区切りまで見る", () => {
    // `/accountlike` は共有画面ではない。参加者画面として扱う。
    expect(viewerRole("/accountlike", participant)).toBe("participant");
    expect(viewerRole("/accountlike", organizer)).toBe("participant");
  });

  it("アカウント設定の本文の戻り先は、ヘッダーの立場と一致する", () => {
    // 主催者なら /mypage、参加者なら /participant。両方の会員で確かめる。
    for (const viewer of [participant, organizer]) {
      const role = viewerRole("/account", viewer);
      const target = accountReturnTarget(viewer.isOrganizer);

      expect(target.href).toBe(role === "organizer" ? "/mypage" : "/participant");
      // 文言も `SITE` の既存のものを使う（本文だけ別の言い方にしない）。
      expect(target).toEqual(role === "organizer" ? SITE.nav.mypage : SITE.nav.participantHome);
    }
  });

  it("アカウント設定の配下でもバーのナビを持たない", () => {
    const config = siteNavConfig("/account/email/verify", organizer);

    // 行き先は本文と頭文字のメニューが持つ。バーには重ねない。
    expect(config.links).toEqual([]);
    expect(config.primary).toBeUndefined();
    expect(config.action).toBeUndefined();
  });

  it("主催イベントを持たない会員は、アカウント設定でも参加者の札と参加者ホームへの戻り先になる", () => {
    expect(viewerRole("/account", participant)).toBe("participant");
    expect(viewerRoleCaption(viewerRole("/account", participant))).toBe("参加者アカウント");
    expect(accountReturnTarget(false)).toEqual(SITE.nav.participantHome);
    expect(accountReturnTarget(false).href).toBe("/participant");
  });
});
