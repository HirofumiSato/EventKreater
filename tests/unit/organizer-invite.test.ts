import { describe, expect, it } from "vitest";
import { showsOrganizerInvite } from "@/modules/events/lib/organizer-invite";

/** 誘いを出すかの判定に要る項目だけを、既定値つきで作る。 */
function viewer(overrides: {
  loggedIn?: boolean;
  name?: string | null;
  isThisEventsOrganizer?: boolean;
  hasOrganizerRole?: boolean;
}) {
  return {
    loggedIn: false,
    name: null,
    isThisEventsOrganizer: false,
    hasOrganizerRole: false,
    ...overrides,
  };
}

describe("主催者への誘いを出すか", () => {
  it("未ログインの参加者には出す", () => {
    expect(showsOrganizerInvite(viewer({}))).toBe(true);
  });

  it("この催しの幹事（ゲスト幹事の端末を含む）には出さない", () => {
    expect(showsOrganizerInvite(viewer({ isThisEventsOrganizer: true }))).toBe(false);
  });

  it("すでに主催イベントを持つ会員には出さない", () => {
    expect(showsOrganizerInvite(viewer({ hasOrganizerRole: true }))).toBe(false);
  });

  it("主催イベントを持たない共同主催には出す", () => {
    // 共同主催でも、自分ではまだ開いていない会員には次の催しを勧めてよい。
    expect(showsOrganizerInvite(viewer({ loggedIn: true, name: "高橋 直樹" }))).toBe(true);
  });
});
