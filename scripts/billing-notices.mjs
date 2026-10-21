/**
 * 0円月額の終了前案内（3日前・1日前）を送るバッチ。
 *
 *   node scripts/billing-notices.mjs
 *
 * cron では次のように1日1回叩く。
 *   0 10 * * * cd /path/to/app && node scripts/billing-notices.mjs
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function loadEnv() {
  try {
    const raw = readFileSync(resolve(process.cwd(), ".env"), "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
      if (!match) continue;
      const [, key, value] = match;
      if (process.env[key] !== undefined) continue;
      process.env[key] = value.replace(/^["']|["']$/g, "");
    }
  } catch {
    // .env が無い場合は、シェルの環境変数だけを使う。
  }
}

loadEnv();

const base = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3012";
const secret = process.env.BILLING_NOTICE_SECRET;

if (!secret) {
  console.error("BILLING_NOTICE_SECRET が設定されていません。.env を確認してください。");
  process.exit(1);
}

const response = await fetch(`${base}/api/v1/internal/billing/notices`, {
  method: "POST",
  headers: { "x-billing-secret": secret },
});

const body = await response.text();
if (!response.ok) {
  console.error(`案内の送信に失敗しました (${response.status}): ${body}`);
  process.exit(1);
}

console.log(body);
