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
};

export default nextConfig;
