/** @type {import('next').NextConfig} */
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
    if (process.env.APP_ENV !== "staging") {
      return [];
    }
    return [
      {
        source: "/:path*",
        headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }],
      },
    ];
  },
};

export default nextConfig;
