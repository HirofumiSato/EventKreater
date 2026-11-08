import { describe, expect, it } from "vitest";
import { showOrganizerTabs, showParticipantTabs, siteChrome } from "@/lib/site-chrome";

describe("公開クロムの出し分け", () => {
  it("ホームは LP として扱い、ヘッダーを出さず上端の余白も落とす", () => {
    expect(siteChrome("/")).toEqual({ header: false, footer: true, main: true, flushTop: true });
  });

  it("管理コンソールはヘッダーもフッターも出さない", () => {
    expect(siteChrome("/console")).toEqual({
      header: false,
      footer: false,
      main: true,
      flushTop: false,
    });
    expect(siteChrome("/console/users")).toEqual({
      header: false,
      footer: false,
      main: true,
      flushTop: false,
    });
  });

  it("その他の画面はヘッダーとフッターを出し、main も SiteChrome が描く", () => {
    expect(siteChrome("/service")).toEqual({
      header: true,
      footer: true,
      main: true,
      flushTop: false,
    });
    expect(siteChrome("/organizer/events")).toEqual({
      header: true,
      footer: true,
      main: true,
      flushTop: false,
    });
  });

  it("主催者の公開ページの一覧は共通ヘッダーを出さず、main とフッターを残す", () => {
    expect(siteChrome("/organizers")).toEqual({
      header: false,
      footer: true,
      main: true,
      flushTop: false,
    });
  });

  it("告知ページの一覧は共通ヘッダーを出さず、main とフッターを残す", () => {
    expect(siteChrome("/events")).toEqual({
      header: false,
      footer: true,
      main: true,
      flushTop: false,
    });
  });

  it("告知ページの見本の一覧は main とフッターを残し、帯を画面の上端から始める", () => {
    expect(siteChrome("/sample")).toEqual({
      header: false,
      footer: true,
      main: true,
      flushTop: true,
    });
  });

  it("下書きプレビューはヘッダーを出したまま上端の余白を落とす", () => {
    expect(siteChrome("/organizer/events/abc/preview")).toEqual({
      header: true,
      footer: true,
      main: true,
      flushTop: true,
    });
    expect(siteChrome("/organizer/events/abc/preview/")).toEqual({
      header: true,
      footer: true,
      main: true,
      flushTop: true,
    });
  });

  it("プレビュー以外の主催者画面は余白を落とさない", () => {
    expect(siteChrome("/organizer/events/abc/edit")).toEqual({
      header: true,
      footer: true,
      main: true,
      flushTop: false,
    });
    expect(siteChrome("/organizer/events/preview")).toEqual({
      header: true,
      footer: true,
      main: true,
      flushTop: false,
    });
  });

  it("区切りを跨いだ前方一致をしない", () => {
    expect(siteChrome("/consolelike")).toEqual({
      header: true,
      footer: true,
      main: true,
      flushTop: false,
    });
    expect(siteChrome("/organizerslike")).toEqual({
      header: true,
      footer: true,
      main: true,
      flushTop: false,
    });
    expect(siteChrome("/eventslike")).toEqual({
      header: true,
      footer: true,
      main: true,
      flushTop: false,
    });
    expect(siteChrome("/samplelike")).toEqual({
      header: true,
      footer: true,
      main: true,
      flushTop: false,
    });
  });

  it("パスが空でも通常の画面として扱う", () => {
    expect(siteChrome("")).toEqual({ header: true, footer: true, main: true, flushTop: false });
  });

  it("テーマ付きの公開ページは main とフッターをページ側の器へ渡す", () => {
    // フッターをテーマの地の内側へ置くため、SiteChrome は main もフッターも描かない。
    expect(siteChrome("/events/abc")).toEqual({
      header: false,
      footer: false,
      main: false,
      flushTop: true,
    });
    expect(siteChrome("/organizers/abc")).toEqual({
      header: false,
      footer: false,
      main: false,
      flushTop: false,
    });
    expect(siteChrome("/sample/dj")).toEqual({
      header: false,
      footer: false,
      main: false,
      flushTop: true,
    });
    expect(siteChrome("/sample/profile/abc")).toEqual({
      header: false,
      footer: false,
      main: false,
      flushTop: true,
    });
    // 招待だけは共通ヘッダーを残す（案内の入口なので、行き先を見せる）。
    expect(siteChrome("/invite/abc")).toEqual({
      header: true,
      footer: false,
      main: false,
      flushTop: false,
    });
  });

  it("テーマ付きの公開ページでも末尾のスラッシュは同じ段として扱う", () => {
    expect(siteChrome("/events/abc/").main).toBe(false);
    expect(siteChrome("/organizers/abc/").main).toBe(false);
    expect(siteChrome("/invite/abc/").main).toBe(false);
    expect(siteChrome("/sample/dj/").main).toBe(false);
    expect(siteChrome("/sample/profile/abc/").main).toBe(false);
  });

  it("段が無い・深すぎるパスはテーマ付きの公開ページにしない", () => {
    // 段の無い一覧は main とフッターを残す。
    expect(siteChrome("/invite")).toEqual({
      header: true,
      footer: true,
      main: true,
      flushTop: false,
    });
    expect(siteChrome("/sample/profile")).toEqual({
      header: false,
      footer: true,
      main: true,
      flushTop: true,
    });
    // 配下の画面（2 段目以降）も main とフッターを残す。
    expect(siteChrome("/organizers/abc/events").main).toBe(true);
    expect(siteChrome("/events/abc/edit").main).toBe(true);
    expect(siteChrome("/sample/dj/extra").main).toBe(true);
    expect(siteChrome("/sample/profile/abc/extra").main).toBe(true);
  });
});

describe("主催者の節（OrganizerTabs）の出し分け", () => {
  it("主催者管理の入口画面では出す", () => {
    expect(showOrganizerTabs("/mypage")).toBe(true);
    expect(showOrganizerTabs("/notifications")).toBe(true);
    expect(showOrganizerTabs("/organizer/events")).toBe(true);
    expect(showOrganizerTabs("/organizer/events/drafts")).toBe(true);
    expect(showOrganizerTabs("/organizer/revenue")).toBe(true);
    expect(showOrganizerTabs("/organizer/calendar")).toBe(true);
    expect(showOrganizerTabs("/organizer/profile")).toBe(true);
  });

  it("イベント単位の名簿と売上では出す", () => {
    expect(showOrganizerTabs("/organizer/events/abc/participants")).toBe(true);
    expect(showOrganizerTabs("/organizer/events/abc/revenue")).toBe(true);
  });

  it("作成・編集・プレビュー・登録案内では出さない", () => {
    expect(showOrganizerTabs("/organizer/events/new")).toBe(false);
    expect(showOrganizerTabs("/organizer/events/abc")).toBe(false);
    expect(showOrganizerTabs("/organizer/events/abc/edit")).toBe(false);
    expect(showOrganizerTabs("/organizer/events/abc/preview")).toBe(false);
    expect(showOrganizerTabs("/organizer/register-required")).toBe(false);
  });

  it("主催者エリア以外では出さない", () => {
    expect(showOrganizerTabs("/organizer/events/revenueish")).toBe(false);
    expect(showOrganizerTabs("/participant")).toBe(false);
    expect(showOrganizerTabs("/service")).toBe(false);
    expect(showOrganizerTabs("/")).toBe(false);
    expect(showOrganizerTabs("")).toBe(false);
  });
});

describe("参加者の節（ParticipantTabs）の出し分け", () => {
  it("参加者の画面では出す", () => {
    expect(showParticipantTabs("/participant")).toBe(true);
    expect(showParticipantTabs("/participant/calendar")).toBe(true);
    expect(showParticipantTabs("/participant/history")).toBe(true);
  });

  it("参加者ログインの入口では出さない", () => {
    expect(showParticipantTabs("/participant/login")).toBe(false);
  });

  it("参加者エリア以外では出さない", () => {
    expect(showParticipantTabs("/participantlike")).toBe(false);
    expect(showParticipantTabs("/participant/calendar/extra")).toBe(false);
    expect(showParticipantTabs("/organizer/events")).toBe(false);
    expect(showParticipantTabs("/account")).toBe(false);
    expect(showParticipantTabs("/")).toBe(false);
    expect(showParticipantTabs("")).toBe(false);
  });
});
