import { describe, expect, it } from "vitest";
import { showOrganizerTabs, siteChrome } from "@/lib/site-chrome";

describe("公開クロムの出し分け", () => {
  it("ホームは LP として扱い、ヘッダーを出さず上端の余白も落とす", () => {
    expect(siteChrome("/")).toEqual({ header: false, footer: true, flushTop: true });
  });

  it("管理コンソールはヘッダーもフッターも出さない", () => {
    expect(siteChrome("/console")).toEqual({ header: false, footer: false, flushTop: false });
    expect(siteChrome("/console/users")).toEqual({
      header: false,
      footer: false,
      flushTop: false,
    });
  });

  it("その他の画面はヘッダーとフッターを出し、余白は普段どおり", () => {
    expect(siteChrome("/service")).toEqual({ header: true, footer: true, flushTop: false });
    expect(siteChrome("/organizer/events")).toEqual({
      header: true,
      footer: true,
      flushTop: false,
    });
  });

  it("主催者の公開ページは共通ヘッダーを出さない", () => {
    expect(siteChrome("/organizers/abc")).toEqual({
      header: false,
      footer: true,
      flushTop: false,
    });
    expect(siteChrome("/organizers")).toEqual({ header: false, footer: true, flushTop: false });
  });

  it("告知ページは共通ヘッダーを出さず、チラシを画面の上端から始める", () => {
    expect(siteChrome("/events/abc")).toEqual({ header: false, footer: true, flushTop: true });
    expect(siteChrome("/events")).toEqual({ header: false, footer: true, flushTop: false });
    expect(siteChrome("/events/abc/receipt")).toEqual({
      header: false,
      footer: true,
      flushTop: false,
    });
  });

  it("告知ページの見本は共通ヘッダーを出さず、帯を画面の上端から始める", () => {
    expect(siteChrome("/sample")).toEqual({ header: false, footer: true, flushTop: true });
    expect(siteChrome("/sample/dj")).toEqual({ header: false, footer: true, flushTop: true });
    expect(siteChrome("/sample/dj/")).toEqual({ header: false, footer: true, flushTop: true });
  });

  it("下書きプレビューはヘッダーを出したまま上端の余白を落とす", () => {
    expect(siteChrome("/organizer/events/abc/preview")).toEqual({
      header: true,
      footer: true,
      flushTop: true,
    });
    expect(siteChrome("/organizer/events/abc/preview/")).toEqual({
      header: true,
      footer: true,
      flushTop: true,
    });
  });

  it("プレビュー以外の主催者画面は余白を落とさない", () => {
    expect(siteChrome("/organizer/events/abc/edit")).toEqual({
      header: true,
      footer: true,
      flushTop: false,
    });
    expect(siteChrome("/organizer/events/preview")).toEqual({
      header: true,
      footer: true,
      flushTop: false,
    });
  });

  it("区切りを跨いだ前方一致をしない", () => {
    expect(siteChrome("/consolelike")).toEqual({ header: true, footer: true, flushTop: false });
    expect(siteChrome("/organizerslike")).toEqual({ header: true, footer: true, flushTop: false });
    expect(siteChrome("/eventslike")).toEqual({ header: true, footer: true, flushTop: false });
    expect(siteChrome("/samplelike")).toEqual({ header: true, footer: true, flushTop: false });
  });

  it("パスが空でも通常の画面として扱う", () => {
    expect(siteChrome("")).toEqual({ header: true, footer: true, flushTop: false });
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

  it("作成・編集・プレビュー・領収書・登録案内では出さない", () => {
    expect(showOrganizerTabs("/organizer/events/new")).toBe(false);
    expect(showOrganizerTabs("/organizer/events/abc")).toBe(false);
    expect(showOrganizerTabs("/organizer/events/abc/edit")).toBe(false);
    expect(showOrganizerTabs("/organizer/events/abc/preview")).toBe(false);
    expect(showOrganizerTabs("/organizer/events/abc/receipts/xyz")).toBe(false);
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
