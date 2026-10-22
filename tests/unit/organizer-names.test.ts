import { describe, expect, it } from "vitest";
import {
  isGuestOrganizer,
  organizerDisplayName,
  organizerLabel,
  organizerRoleLabel,
} from "@/modules/organizers/lib/names";
import { serializeOrganizerList, serializePublicOrganizerList } from "@/lib/serializers";

describe("organizerDisplayName", () => {
  it("会員はアカウントの表示名を優先する", () => {
    expect(
      organizerDisplayName({ role: "OWNER", displayName: "ゲスト名", user: { name: "会員名" } }),
    ).toBe("会員名");
  });

  it("未登録の幹事は保存した表示名を使う", () => {
    expect(organizerDisplayName({ role: "OWNER", displayName: "山田 太郎", user: null })).toBe(
      "山田 太郎",
    );
  });

  it("前後の空白だけの名前は無いものとして扱う", () => {
    expect(organizerDisplayName({ role: "OWNER", displayName: "   ", user: { name: " " } })).toBe(
      null,
    );
  });

  it("名前が無ければ null を返す（画面は役割名を出す）", () => {
    expect(organizerDisplayName({ role: "CO_HOST" })).toBeNull();
  });

  it("表示名は必ず空にしない", () => {
    expect(organizerLabel({ role: "OWNER" })).toBe("主催者");
    expect(organizerLabel({ role: "CO_HOST" })).toBe("共同主催者");
    expect(organizerRoleLabel("OWNER")).toBe("主催者");
  });

  it("userId の有無でゲスト幹事を判定する", () => {
    expect(isGuestOrganizer({ userId: null })).toBe(true);
    expect(isGuestOrganizer({ userId: "user-1" })).toBe(false);
  });
});

describe("serializeOrganizerList", () => {
  const rows = [
    { id: "co-2", role: "CO_HOST" as const, userId: "u2", displayName: null, user: { name: "田中" } },
    { id: "owner", role: "OWNER" as const, userId: "u1", displayName: null, user: { name: "佐藤" } },
    { id: "co-1", role: "CO_HOST" as const, userId: null, displayName: "鈴木", user: null },
  ];

  it("筆頭幹事を先頭に分け、共同主催は作成順を保つ", () => {
    const list = serializeOrganizerList(rows);
    expect(list.owner?.name).toBe("佐藤");
    expect(list.coHosts.map((row) => row.name)).toEqual(["田中", "鈴木"]);
    expect(list.coHosts[1].isGuest).toBe(true);
  });

  it("オーナーが居ない旧データでは owner を null にする", () => {
    const list = serializeOrganizerList([rows[0]]);
    expect(list.owner).toBeNull();
    expect(list.coHosts).toHaveLength(1);
  });

  it("公開用は名前だけを返し、IDを持たせない", () => {
    const publicList = serializePublicOrganizerList(rows);
    expect(publicList).toEqual({
      owner: { name: "佐藤" },
      coHosts: [{ name: "田中" }, { name: "鈴木" }],
    });
    const serialized = JSON.stringify(publicList);
    expect(serialized).not.toContain("co-1");
    expect(serialized).not.toContain("u1");
  });
});
