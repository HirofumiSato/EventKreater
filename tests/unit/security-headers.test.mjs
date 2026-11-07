// next.config.mjs の headers() が返す規則を固定する。
//
// ここが崩れると、クリックジャッキング（frame-ancestors）や
// 招待コードの Referer 漏れ、staging の noindex が黙って消える。

import { afterEach, describe, expect, it } from "vitest";

import nextConfig from "../../next.config.mjs";

const ORIGINAL_APP_ENV = process.env.APP_ENV;

afterEach(() => {
  if (ORIGINAL_APP_ENV === undefined) delete process.env.APP_ENV;
  else process.env.APP_ENV = ORIGINAL_APP_ENV;
});

/** APP_ENV を差し替えて headers() を呼ぶ。 */
async function rulesFor(appEnv) {
  if (appEnv === undefined) delete process.env.APP_ENV;
  else process.env.APP_ENV = appEnv;
  return nextConfig.headers();
}

/** 規則 1 本のヘッダーを、小文字の key で引ける形にする。 */
function headerMap(rule) {
  return Object.fromEntries(rule.headers.map(({ key, value }) => [key.toLowerCase(), value]));
}

function findRule(rules, source) {
  return rules.find((rule) => rule.source === source);
}

function robotsTagRules(rules) {
  return rules.filter((rule) =>
    rule.headers.some(({ key }) => key.toLowerCase() === "x-robots-tag"),
  );
}

describe("応答ヘッダー", () => {
  it.each([
    ["未指定", undefined],
    ["staging", "staging"],
    ["production", "production"],
  ])("%s でも共通のセキュリティヘッダーを付ける", async (_label, appEnv) => {
    const rules = await rulesFor(appEnv);
    const headers = headerMap(findRule(rules, "/:path*"));

    expect(headers["x-content-type-options"]).toBe("nosniff");
    expect(headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
    expect(headers["x-frame-options"]).toBe("DENY");
    expect(headers["permissions-policy"]).toBe(
      "camera=(), geolocation=(), microphone=(self)",
    );
    expect(headers["content-security-policy"]).toContain("frame-ancestors 'none'");
    expect(headers["content-security-policy"]).toContain("object-src 'none'");
    expect(headers["content-security-policy"]).toContain("base-uri 'self'");
    expect(headers["content-security-policy"]).toContain("form-action 'self'");
    // script-src は入れない（Next.js のインライン script と GA が落ちる）。
    expect(headers["content-security-policy"]).not.toContain("script-src");
  });

  it("本番だけ HSTS を付け、staging と未指定では付けない", async () => {
    const production = headerMap(findRule(await rulesFor("production"), "/:path*"));
    expect(production["strict-transport-security"]).toContain("max-age=");

    const staging = headerMap(findRule(await rulesFor("staging"), "/:path*"));
    expect(staging["strict-transport-security"]).toBeUndefined();

    const local = headerMap(findRule(await rulesFor(undefined), "/:path*"));
    expect(local["strict-transport-security"]).toBeUndefined();
  });

  it("staging では全パスに noindex を 1 回だけ付ける", async () => {
    const rules = await rulesFor("staging");

    // "/:path*" 1 本にまとめ、パス別の規則は足さない。
    expect(rules).toHaveLength(1);
    expect(robotsTagRules(rules)).toHaveLength(1);
    expect(headerMap(rules[0])["x-robots-tag"]).toBe("noindex, nofollow");
  });

  it("本番では秘匿パスだけに noindex を付ける", async () => {
    const rules = await rulesFor("production");
    const noindexSources = robotsTagRules(rules).map((rule) => rule.source);

    expect(noindexSources).toEqual([
      "/console/:path*",
      "/events/:path*",
      "/organizers/:path*",
      "/organizer/:path*",
      "/invitations/:path*",
      "/invite/:path*",
      "/sample/:path*",
      "/auth/:path*",
      "/participant/:path*",
      "/account/:path*",
      "/mypage",
      "/notifications",
      "/api/:path*",
    ]);
    // 公開してよい "/"・"/service"・"/terms"・"/privacy"・"/tokushoho" には付けない。
    expect(findRule(rules, "/:path*").headers).not.toContainEqual(
      expect.objectContaining({ key: "X-Robots-Tag" }),
    );
    expect(findRule(rules, "/service")).toBeUndefined();
    expect(findRule(rules, "/terms")).toBeUndefined();
    expect(findRule(rules, "/privacy")).toBeUndefined();
    expect(findRule(rules, "/tokushoho")).toBeUndefined();
    // どのパスも X-Robots-Tag を二重に持たない。
    for (const rule of rules) {
      const count = rule.headers.filter(({ key }) => key.toLowerCase() === "x-robots-tag").length;
      expect(count).toBeLessThanOrEqual(1);
    }
  });
});
