import type { MetadataRoute } from "next";

// APP_ENV は実行時に読む。静的化するとビルド時の値で固定され、
// staging でも production と同じ robots.txt が返ってしまう。
export const dynamic = "force-dynamic";

export default function robots(): MetadataRoute.Robots {
  // staging はテスト決済とダミーデータが見えるため、全文を検索から外す。
  if (process.env.APP_ENV === "staging") {
    return {
      rules: { userAgent: "*", disallow: "/" },
    };
  }

  return {
    rules: {
      userAgent: "*",
      // /invitations/ は応答ヘッダーの noindex と同じ二重掛け。
      // 索引させないことが目的なので、disallow と noindex は併用してよい。
      disallow: ["/console", "/organizers/", "/invitations/"],
    },
  };
}
