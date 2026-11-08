/**
 * 結合テストはテスト専用の DB を使う。
 * TEST_DATABASE_URL があるときだけ DATABASE_URL を差し替え、開発用 DB へ書き込まない。
 */
const testDatabaseUrl = process.env.TEST_DATABASE_URL;

if (testDatabaseUrl) {
  process.env.DATABASE_URL = testDatabaseUrl;
} else {
  // 無いときは空で固定する。Prisma Client は読み込み時に `.env` を process.env へ入れるので、
  // 何もしないと各テストの `TEST_DATABASE_URL ? describe : describe.skip` が評価される頃には
  // `.env` の値が見えてしまい、skip されずに `DATABASE_URL`（開発用）のまま結合テストが走る。
  // Prisma は既にあるキーを上書きしないので、空を入れておけば skip のままになる。
  process.env.TEST_DATABASE_URL = "";
}
