import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // DB を使うテストの接続先を、テスト用 DB へ向ける（tests/setup/db.ts）。
    setupFiles: ["tests/setup/db.ts"],
  },
});
