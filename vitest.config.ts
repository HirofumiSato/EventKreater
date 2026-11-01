import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  // 画面の試験（`tests/components/`）は TSX をそのまま書く。React 18 の自動ランタイムに合わせる。
  esbuild: { jsx: "automatic" },
  test: {
    environment: "node",
    // CI の判定のような、TypeScript を使わない素の .mjs も試験する。
    // 画面の試験は `// @vitest-environment jsdom` で環境を切り替える（Node は既定のまま）。
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx", "tests/**/*.test.mjs"],
    // DB を使うテストの接続先を、テスト用 DB へ向ける（tests/setup/db.ts）。
    setupFiles: ["tests/setup/db.ts"],
  },
});
