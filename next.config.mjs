/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // UI 検証の本番ビルドは、開発サーバーの .next を壊さないよう別の出力先へ出す。既定は .next。
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // Docker（Dockerfile の runner ステージ）で .next/standalone を使う。
  // 開発サーバーの挙動は変わらない。
  output: "standalone",
};

export default nextConfig;
