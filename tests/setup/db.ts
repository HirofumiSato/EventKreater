/**
 * 結合テストはテスト専用の DB を使う。
 * TEST_DATABASE_URL があるときだけ DATABASE_URL を差し替え、開発用 DB へ書き込まない。
 */
const testDatabaseUrl = process.env.TEST_DATABASE_URL;

if (testDatabaseUrl) {
  process.env.DATABASE_URL = testDatabaseUrl;
}
