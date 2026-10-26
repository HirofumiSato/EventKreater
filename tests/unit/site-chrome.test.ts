import { describe, expect, it } from "vitest";
import { siteChrome } from "@/lib/site-chrome";

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
    expect(siteChrome("/events/abc")).toEqual({ header: true, footer: true, flushTop: false });
  });

  it("主催者の公開ページは共通ヘッダーを出さない", () => {
    expect(siteChrome("/organizers/abc")).toEqual({
      header: false,
      footer: true,
      flushTop: false,
    });
    expect(siteChrome("/organizers")).toEqual({ header: false, footer: true, flushTop: false });
  });

  it("区切りを跨いだ前方一致をしない", () => {
    expect(siteChrome("/consolelike")).toEqual({ header: true, footer: true, flushTop: false });
    expect(siteChrome("/organizerslike")).toEqual({ header: true, footer: true, flushTop: false });
  });

  it("パスが空でも通常の画面として扱う", () => {
    expect(siteChrome("")).toEqual({ header: true, footer: true, flushTop: false });
  });
});
