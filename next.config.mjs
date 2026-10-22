/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Docker（Dockerfile の runner ステージ）で .next/standalone を使う。
  // 開発サーバーの挙動は変わらない。
  output: "standalone",
};

export default nextConfig;
