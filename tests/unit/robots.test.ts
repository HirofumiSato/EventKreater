import { afterEach, describe, expect, it } from "vitest";

import robots from "@/app/robots";

// robots() は呼び出し時に APP_ENV を読む（src/app/robots.ts）。
// テストの前後で差し替え、終わったら元に戻す。
const ORIGINAL_APP_ENV = process.env.APP_ENV;

afterEach(() => {
  if (ORIGINAL_APP_ENV === undefined) delete process.env.APP_ENV;
  else process.env.APP_ENV = ORIGINAL_APP_ENV;
});

/** rules が 1 本でも配列でも、disallow を平らな文字列の配列にする。 */
function disallowEntries(): string[] {
  const { rules } = robots();
  const list = Array.isArray(rules) ? rules : [rules];
  return list.flatMap((rule) => {
    const disallow = rule.disallow;
    if (!disallow) return [];
    return Array.isArray(disallow) ? disallow : [disallow];
  });
}

describe("robots.txt", () => {
  it("本番では管理画面・主催者ページ・招待ページを索引させない", () => {
    delete process.env.APP_ENV;

    const disallow = disallowEntries();
    expect(disallow).toContain("/console");
    expect(disallow).toContain("/organizers/");
    expect(disallow).toContain("/invitations/");
  });

  it("staging では全パスを索引させない", () => {
    process.env.APP_ENV = "staging";

    expect(disallowEntries()).toContain("/");
  });
});
