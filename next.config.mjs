/** @type {import('next').NextConfig} */

// 全環境に付ける応答ヘッダー。
//
// frame-ancestors 'none' が本命。未ログインでも POST できる出欠の画面を iframe に重ねる
// クリックジャッキングを塞ぐ。X-Frame-Options は frame-ancestors を読まない古いブラウザ向け。
// Referrer-Policy は、招待コードがパスに載るため必須（クロスオリジンには origin だけを送る）。
// Permissions-Policy の microphone=(self) は音声入力のために開ける。camera / geolocation は使わない。
//
// script-src は入れない。入れると Next.js が差し込むインライン script と GA（gtag.js）が落ちる。
// nonce 方式は別 PR で扱う。
const SECURITY_HEADERS = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Permissions-Policy", value: "camera=(), geolocation=(), microphone=(self)" },
  {
    key: "Content-Security-Policy",
    value: "frame-ancestors 'none'; object-src 'none'; base-uri 'self'; form-action 'self'",
  },
];

// HSTS は本番だけ。staging は http で確かめることがあり、付けると戻れなくなる。
const HSTS_HEADER = {
  key: "Strict-Transport-Security",
  value: "max-age=63072000; includeSubDomains",
};

// HTML の <meta name="robots"> を読まないクローラ向け。全環境で付ける。
const NOINDEX_HEADER = { key: "X-Robots-Tag", value: "noindex, nofollow" };

// 検索結果に載せないパス。公開してよいのは "/"・"/service"・"/terms"・"/privacy"・"/tokushoho" だけ。
// 招待 URL は共同主催の権限を持つため、とくに載せない。
const PRIVATE_PATH_PATTERNS = [
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
];

/**
 * headers() が返す規則を組み立てる。
 * APP_ENV は呼び出し時に読む（テストから差し替えられるようにするため）。
 */
function buildHeaderRules(appEnv) {
  const isStaging = appEnv === "staging";
  const isProduction = appEnv === "production";

  // "/:path*" の規則は 1 本にまとめる。staging の全パス noindex とパス別の noindex を
  // 別々の規則で返すと、同じパスに X-Robots-Tag が二重に出る。
  const commonHeaders = [...SECURITY_HEADERS];
  if (isProduction) commonHeaders.push(HSTS_HEADER);
  if (isStaging) commonHeaders.push(NOINDEX_HEADER);

  const rules = [{ source: "/:path*", headers: commonHeaders }];

  // staging は全パスが noindex なので、パス別の規則は足さない。
  if (!isStaging) {
    for (const source of PRIVATE_PATH_PATTERNS) {
      rules.push({ source, headers: [NOINDEX_HEADER] });
    }
  }

  return rules;
}

const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // UI 検証の本番ビルドは、開発サーバーの .next を壊さないよう別の出力先へ出す。既定は .next。
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // Docker（Dockerfile の runner ステージ）で .next/standalone を使う。
  // 開発サーバーの挙動は変わらない。
  output: "standalone",
  experimental: {
    // pdf-lib は標準フォントのメトリクスを pako で伸長する。Turbopack が同梱した
    // pako では伸長に失敗し、PDF に文字を描けない。Node の解決に任せて外部化する。
    serverComponentsExternalPackages: ["pdf-lib", "@pdf-lib/standard-fonts"],
  },
  // staging はテスト決済とダミーデータが見えるため、全パスを検索から外す。
  // robots.txt（src/app/robots.ts）だけでは HTML 内のリンクを辿られることがあるので、
  // 応答ヘッダーでも noindex を付ける。
  //
  // 注意: headers() はビルド時に評価される。APP_ENV は Docker の build args
  // （Dockerfile の ARG/ENV）で渡す前提で、実行時の環境変数では切り替わらない。
  async headers() {
    return buildHeaderRules(process.env.APP_ENV);
  },
};

export default nextConfig;
