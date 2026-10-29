# ローカル環境の起動・停止・操作

このページは、手元のマシンで PostgreSQL と Next.js を起動し、画面とコマンドからアプリを操作する手順です。アプリは `http://localhost:3000` 、データベースは `127.0.0.1:5432` の `event_platform_lp` を使います。

## 必要なもの

- Node.js 24 以上
- npm
- 空きポート `3000` と `5432`

データベースは `npm run db:up` で起動する組み込み PostgreSQL を使います。接続ユーザーは `postgres` / `postgres` です。`embedded-postgres` が `.pgdata` にデータを置きます。

## 環境変数

リポジトリ直下に `.env` を置きます。雛形は `.env.example` です。

```powershell
Copy-Item .env.example .env
```

組み込み PostgreSQL を使うときの `DATABASE_URL` は次です。

```text
DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:5432/event_platform_lp?schema=public"
JWT_SECRET="local-dev-jwt-secret-32chars-min!!"
TOKEN_SALT="local-dev-token-salt-32chars-min!!"
NEXT_PUBLIC_APP_URL="http://localhost:3000"
```

`JWT_SECRET` と `TOKEN_SALT` はそれぞれ 32 文字以上にします。すでに別の PostgreSQL が `5432` で動いている場合は、そのユーザーとデータベース名に `DATABASE_URL` を合わせます。

## 起動

ターミナルは 2 つ使います。1 つはデータベース、もう 1 つはアプリです。作業ディレクトリはリポジトリのルートです。

### 1. 依存パッケージ

```powershell
npm install
```

`postinstall` で `prisma generate` が走り、Prisma Client が生成されます。

### 2. PostgreSQL

```powershell
npm run db:up
```

このコマンドはフォアグラウンドで待ち受けます。初回だけ `.pgdata` を初期化し、データベース `event_platform_lp` を作成します。準備ができると、次のような接続先を表示します。

```text
PostgreSQL 16+ listening on postgresql://postgres:postgres@127.0.0.1:5432/event_platform_lp
```

ポート `5432` がすでに開いているときは、新しいクラスタを起動せずに終了します。その場合、待ち受けている既存の PostgreSQL をそのまま使います。

`npm run db:up -- --detach` はプロセス終了時にクラスタも停止します。常駐起動には使いません。

### 3. マイグレーションとシード

アプリ用ターミナルで、既存のマイグレーションを適用します。

```powershell
npx prisma migrate deploy
```

サンプルデータを入れる場合:

```powershell
npx prisma db seed
```

シードはユーザー、イベント、出欠、招待、ロックを削除してから、次のデータを入れ直します。

| 項目 | 値 |
| --- | --- |
| 幹事メール | `organizer@example.com` |
| パスワード | `Testpass123!` |
| 公開イベント | `/events/33333333-3333-4333-8333-333333333333` |
| 下書きイベント | ID `44444444-4444-4444-8444-444444444444` |

### 4. アプリケーション

```powershell
npm run dev
```

ブラウザで `http://localhost:3000` を開きます。データベース接続の確認は `http://localhost:3000/api/health` です。PostgreSQL に接続できていれば `{"ok":true}` が返ります。

## 停止

1. `npm run dev` のターミナルで Ctrl+C を押し、Next.js を止めます。
2. `npm run db:up` のターミナルで Ctrl+C を押します。`.pgdata` は残るので、次回の `npm run db:up` で同じデータを使えます。

`npm run db:up` が「すでにポートを使用中」としてすぐ終了した場合、その PostgreSQL はこのコマンドの管理外です。OS のサービス側で停止します。

## 画面の操作

### 公開ページと出欠

1. `http://localhost:3000` の「公開中のイベント」からイベントを開くか、シード済みの公開 URL を開きます。
2. 参加または不参加、名前、コメントを送ると出欠が保存されます。会員登録は不要です。
3. 同じブラウザで再度開くと、出欠トークンの Cookie により前回の回答を変更できます。

### 幹事のログインと一覧

1. `http://localhost:3000/auth/login` を開きます。
2. シード済みの `organizer@example.com` / `Testpass123!` でログインします。新規の幹事は `http://localhost:3000/auth/register` から登録します。
3. `http://localhost:3000/organizer/events` で主催イベントを確認します。並び順は開催日が近い順と、作成が新しい順を切り替えられます。
4. 「新規作成」から `http://localhost:3000/organizer/events/new` を開き、title、eventDate、eventTime、price、location、rainPolicy、capacity の 7 項目を入れてイベントを作成します。
5. 一覧のカードから編集、複製、共同幹事の招待、参加者一覧へ進めます。参加状況は `/organizer/events/{id}/participants` です。
6. 自分のアカウントに紐づく情報は `http://localhost:3000/mypage` で確認します。

無料のイベント作成は 2 回までです。上限に達すると作成 API が HTTP 402 を返し、単発 299 円、月額で8件まで公開 980 円、公開し放題 2,980 円の案内が出ます。

## 開発コマンド

| コマンド | 動作 |
| --- | --- |
| `npm run dev` | 開発サーバを `http://localhost:3000` で起動する |
| `npm run build` | 本番ビルドを作る |
| `npm start` | ビルド済みアプリを起動する。先に `npm run build` が必要 |
| `npm run lint` | `tsc --noEmit` で型を検査する |
| `npm run test:e2e` | 起動済みのアプリに対して E2E を実行する。接続先は `E2E_BASE_URL`（既定 `http://localhost:3000`） |
| `npx prisma studio` | ブラウザからテーブルを確認する |
| `npx prisma migrate dev` | スキーマ変更用のマイグレーションを開発中に作成・適用する |

E2E はアプリと PostgreSQL が起動している状態で実行します。

## このドキュメントの HTML を作る

仕様書を含む HTML は、リポジトリ直下で次を実行すると `docs/_build/html/index.html` に出力されます。

```powershell
python -m venv .venv
.\.venv\Scripts\python -m pip install -r docs/requirements.txt
.\.venv\Scripts\python -m sphinx -b html docs docs/_build/html
```

ブラウザで `docs/_build/html/index.html` を開きます。
