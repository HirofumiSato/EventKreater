// マイグレーションの SQL が `prisma migrate deploy` で流せることを固定する。
//
// Prisma Migrate は 1 つのマイグレーションをトランザクションで包む。トランザクションの
// 中で実行できない文（`CONCURRENTLY`・`VACUUM`・`CREATE DATABASE`）を混ぜると、
// 空の DB から履歴を再生できなくなる。CI の `db` ジョブ、`docker compose`、新しい
// 開発環境、Neon の作り直しは、どれも `migrate deploy` で履歴を再生する。
//
// 2026-11-16 に `20261116120000_perf_indexes` がこれで止まった（`CREATE INDEX
// CONCURRENTLY`）。書き込みを止めずに張りたいときは、`migration.sql` からは外して
// 手で流し、`prisma migrate resolve --applied` で履歴だけ記録する（`docs/deploy.rst`）。

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const ROOT = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const MIGRATIONS = path.join(ROOT, "prisma", "migrations");

/** トランザクションの中で流せない文。コメントを落としてから探す。 */
const FORBIDDEN = [
  {
    pattern: /\bCONCURRENTLY\b/i,
    hint: "`CONCURRENTLY` はトランザクションの中で流せません",
  },
  {
    pattern: /^\s*VACUUM\b/im,
    hint: "`VACUUM` はトランザクションの中で流せません",
  },
  {
    pattern: /\bCREATE\s+DATABASE\b/i,
    hint: "`CREATE DATABASE` はトランザクションの中で流せません",
  },
];

/**
 * `--` から行末までを落とす。
 *
 * このリポジトリの SQL は文字列リテラルを使わないので、これで足りる。
 * 説明のコメントに `CONCURRENTLY` と書くこと自体は許す（実際に書いている）。
 */
function withoutComments(sql) {
  return sql.replace(/--.*$/gm, "");
}

/** `migration.sql` の一覧。名前の順に読む（適用順と同じ）。 */
function migrationFiles() {
  return readdirSync(MIGRATIONS, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
    .map((name) => ({ name, file: path.join(MIGRATIONS, name, "migration.sql") }));
}

describe("マイグレーション", () => {
  it("どの SQL も migrate deploy のトランザクションの中で流せる", () => {
    const problems = [];
    for (const { name, file } of migrationFiles()) {
      const sql = withoutComments(readFileSync(file, "utf8"));
      for (const { pattern, hint } of FORBIDDEN) {
        if (pattern.test(sql)) problems.push(`${name}: ${hint}`);
      }
    }
    expect(problems).toEqual([]);
  });

  it("コメントの中の語は判定に含めない", () => {
    const sql = withoutComments("-- CREATE INDEX CONCURRENTLY は使わない\nCREATE INDEX IF NOT EXISTS a ON b(c);");
    expect(FORBIDDEN.some(({ pattern }) => pattern.test(sql))).toBe(false);
  });
});
