// 開発サーバーが「ビルドに失敗したまま」固まったことを見つける判定の仕様。
//
// scripts/lib/dev-stuck.mjs を直接読み込む。ブラウザも DB も使わない。
// ここが広がると、手元のコードの誤りで再起動を繰り返す（編集中に画面が消える）。
// 狭すぎると、OneDrive の掴みでサーバーが 500 を返し続ける状態を見逃す。

import { describe, expect, it } from "vitest";

import {
  isStuckBuildLine,
  shouldRestartNow,
  STUCK_RESTART_DELAY_MS,
  STUCK_RESTART_GRACE_MS,
  STUCK_RESTART_MIN_INTERVAL_MS,
} from "../../scripts/lib/dev-stuck.mjs";

describe("isStuckBuildLine", () => {
  it("Turbopack の EBUSY（globals.css が読めない）を拾う", () => {
    expect(
      isStuckBuildLine(
        "Error: EBUSY: resource busy or locked, open 'C:\\work\\src\\app\\service\\page.tsx'",
      ),
    ).toBe(true);
  });

  it("Webpack の「ソースが読めない」を拾う", () => {
    expect(
      isStuckBuildLine(
        "Error: Failed to read source code from C:\\work\\src\\app\\service\\page.tsx",
      ),
    ).toBe(true);
    expect(isStuckBuildLine("プロセスはファイルにアクセスできません。別のプロセスが使用中です。 (os error 32)")).toBe(true);
  });

  it("原因が手元のコードにある失敗は拾わない", () => {
    expect(isStuckBuildLine(" ⨯ ./src/app/page.tsx:12:5 Type error: 'x' is not defined")).toBe(false);
    expect(isStuckBuildLine(" ✓ Compiled /service in 320ms")).toBe(false);
    expect(isStuckBuildLine(" GET /service 200 in 21ms")).toBe(false);
  });

  it("空や文字列でない値は拾わない", () => {
    expect(isStuckBuildLine("")).toBe(false);
    expect(isStuckBuildLine(undefined)).toBe(false);
    expect(isStuckBuildLine(null)).toBe(false);
  });
});

describe("shouldRestartNow", () => {
  it("まだ立て直していなければ、すぐ立て直す", () => {
    expect(shouldRestartNow({ now: 1_000, lastRestartAt: null })).toBe(true);
  });

  it("間隔が空いていれば立て直す", () => {
    expect(
      shouldRestartNow({ now: 100_000, lastRestartAt: 100_000 - STUCK_RESTART_MIN_INTERVAL_MS }),
    ).toBe(true);
  });

  it("直前に立て直したばかりなら見送る（繰り返さない）", () => {
    expect(
      shouldRestartNow({ now: 10_000, lastRestartAt: 10_000 - STUCK_RESTART_MIN_INTERVAL_MS + 1 }),
    ).toBe(false);
  });
});

describe("待ち時間", () => {
  it("掴んでいた側が離すまで、少し置いてから立て直す", () => {
    expect(STUCK_RESTART_DELAY_MS).toBeGreaterThanOrEqual(1000);
    expect(STUCK_RESTART_DELAY_MS).toBeLessThanOrEqual(5000);
  });

  it("繰り返しの立て直しは 30 秒以上あける", () => {
    expect(STUCK_RESTART_MIN_INTERVAL_MS).toBeGreaterThanOrEqual(30_000);
  });

  it("立て直した直後の読み飛ばしは、起動を待てる長さにする", () => {
    expect(STUCK_RESTART_GRACE_MS).toBeGreaterThanOrEqual(5_000);
    expect(STUCK_RESTART_DELAY_MS + STUCK_RESTART_GRACE_MS).toBeLessThan(STUCK_RESTART_MIN_INTERVAL_MS);
  });
});
