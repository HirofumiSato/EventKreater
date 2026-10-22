# ローカル開発環境構築・自動セットアップ仕様書

> **実装前の設計文書です。** 現在の正は `prisma/schema.prisma` と `src/` のコードです。実装と差分があればコードを優先してください。現在の手順は [local.rst](../../local.rst) にあります。

## 外部サービス完全非依存・コンテナ＋ローカル実行構成

## 1. 環境構築の全体概要

本リポジトリは、外部SaaS（Supabase、Auth0、AWS等）を一切使用せず、ローカル完結で動作するよう設計されています。AIコーディングエージェント（Cursor Composer / Claude Code等）または開発者は、本ドキュメントに記載の設定ファイル群を配置し、`setup.sh` を実行することで環境構築を完了させます。

```text
[ローカル開発基盤アーキテクチャ]
  ├─ Database: PostgreSQL 16 (Docker Compose / ポート 5432)
  ├─ GUI Client: Prisma Studio (localhost:5555)
  ├─ Web & API Server: Next.js App Router (Node.js 20+ / localhost:3000)
  └─ Auth / Security: ローカルHS256署名 JWT (jose) + パスワードハッシュ (bcryptjs)
```

---

## 2. 前提要件（Prerequisites）

ホスト環境（ローカルPC）に以下がインストールされていること。

1. **Docker / Docker Desktop**（または OrbStack / Rancher Desktop）: 稼働中であること
2. **Node.js**: v20.x 以上（LTS推奨）
3. **npm**: v10.x 以上

---

## 3. 設定ファイル構成（Root配置資材）

以下の設定ファイルをプロジェクト直下に作成・配置します。

### 3.1. `docker-compose.yml`（ローカルDB定義）

```yaml
version: '3.8'

services:
  postgres:
    image: postgres:16-alpine
    container_name: event_platform_postgres
    restart: always
    environment:
      POSTGRES_USER: dev_user
      POSTGRES_PASSWORD: dev_password
      POSTGRES_DB: event_platform_dev
    ports:
      - "5432:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U dev_user -d event_platform_dev"]
      interval: 5s
      timeout: 5s
      retries: 5

volumes:
  postgres_data:
```

---

### 3.2. `.env.example`（環境変数テンプレート）

```bash
# ==========================================
# ローカル開発環境変数（本番利用禁止）
# ==========================================

# PostgreSQL 接続文字列 (Dockerコンテナ)
DATABASE_URL="postgresql://dev_user:dev_password@localhost:5432/event_platform_dev?schema=public"

# ローカルJWT秘密鍵 (HS256 / 32文字以上のランダム文字列)
JWT_SECRET="local-development-secret-key-must-be-at-least-32-chars-long-secure"

# ゲスト幹事トークン・照会トークンのハッシュ用ソルト
TOKEN_SALT="local-token-salt-xyz-98765"

# アプリケーションベースURL
NEXT_PUBLIC_APP_URL="http://localhost:3000"

# Node環境
NODE_ENV="development"
```

---

### 3.3. `package.json`（依存パッケージ定義）

外部サービスを使わずに排他制御・認証・API・UIを完結させる最小構成です。

```json
{
  "name": "event-platform",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "next lint",
    "db:up": "docker compose up -d",
    "db:down": "docker compose down",
    "db:migrate": "npx prisma migrate dev",
    "db:studio": "npx prisma studio",
    "setup": "bash setup.sh"
  },
  "dependencies": {
    "@prisma/client": "^5.18.0",
    "bcryptjs": "^2.4.3",
    "jose": "^5.2.0",
    "lucide-react": "^0.395.0",
    "nanoid": "^5.0.7",
    "next": "14.2.5",
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "zod": "^3.23.8"
  },
  "devDependencies": {
    "@types/bcryptjs": "^2.4.6",
    "@types/node": "^20.14.0",
    "@types/react": "^18.3.3",
    "@types/react-dom": "^18.3.0",
    "autoprefixer": "^10.4.19",
    "postcss": "^8.4.38",
    "prisma": "^5.18.0",
    "tailwindcss": "^3.4.4",
    "typescript": "^5.4.5"
  }
}
```

---

### 3.4. `setup.sh`（自動セットアップ・ワンショットスクリプト）

AIまたは開発者が `bash setup.sh` を実行するだけで、コンテナ起動からDBマイグレーションまでが自動完了するスクリプトです。

```bash
#!/usr/bin/env bash
set -e

echo "=== [1/5] 環境変数ファイル (.env) の生成 ==="
if [ ! -f .env ]; then
  cp .env.example .env
  echo ">>> .env を .env.example から作成しました。"
else
  echo ">>> .env は既に存在します。"
fi

echo "=== [2/5] 依存ライブラリのインストール ==="
npm install

echo "=== [3/5] Dockerコンテナ (PostgreSQL) の起動 ==="
docker compose up -d

echo "=== [4/5] PostgreSQLの接続待機 ==="
until docker compose exec -T postgres pg_isready -U dev_user -d event_platform_dev > /dev/null 2>&1; do
  echo ">>> DB起動待機中... (1秒スリープ)"
  sleep 1
done
echo ">>> PostgreSQL 接続成功。"

echo "=== [5/5] Prisma Client生成 & DBマイグレーション実行 ==="
npx prisma generate
npx prisma migrate dev --name init_local_schema

echo "=================================================="
echo "  ローカル環境構築が正常に完了しました！"
echo "  - アプリ起動: npm run dev (http://localhost:3000)"
echo "  - DB確認:     npm run db:studio (http://localhost:5555)"
echo "=================================================="
```

---

## 4. AIコーディングツールへの指示プロンプト（Cursor / Claude Code 用）

CursorのComposerやターミナル連携エージェントを使用する場合、チャット欄に以下のプロンプトをそのまま入力することで、AIが自律的に全手順を実行します。

```text
以下の手順に従い、外部サービスを使わない完全ローカル開発環境を構築・初期化してください。

1. ルートディレクトリに `docker-compose.yml`、`.env.example`、`setup.sh` を作成してください（仕様書の内容に準拠）。
2. `setup.sh` に実行権限（chmod +x setup.sh）を付与し、ターミナルで実行してください。
3. すでに定義されている `prisma/schema.prisma` に基づき、ローカルDBコンテナにマイグレーションが正常に適用されたことを確認してください。
4. `npm run dev` で開発サーバーを起動し、正常にリクエストを受け付けられるか疎通確認を行ってください。
```

---

## 5. トラブルシューティング（AI・開発者共通）

| 事象 | 原因 | 解消手順 |
| :--- | :--- | :--- |
| `port 5432: address already in use` | ホストPCの既存Postgresがポート競合 | `docker-compose.yml` のポートマッピングを `"5433:5432"` に変更し、`.env` の接続文字列のポート番号も `5433` に変更する。 |
| `Cannot connect to the Docker daemon` | Docker Desktopが未起動 | Docker Desktopアプリケーションを起動してから再実行する。 |
| `P1001: Can't reach database server` | DBコンテナ起動前にPrismaが走った | `setup.sh` の待機ロジックを再確認し、`docker compose logs postgres` でコンテナ内部ログを確認する。 |