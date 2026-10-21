# API設計・実装仕様書

## イベント主催者・参加者向け 権限管理＆段階的会員基盤（RESTful / TypeScript準拠）

## 1. 共通アーキテクチャ・設計規約

### 1.1. 通信プロトコル・Base URL
* **プロトコル:** HTTPS / RESTful JSON API
* **Base URL:** `/api/v1`
* **エンコーディング:** UTF-8
* **日付時刻形式:** ISO 8601 拡張形式（UTC表記: `YYYY-MM-DDTHH:mm:ss.sssZ`）

### 1.2. 認証・認可方式（ハイブリッド・ケイパビリティ認証）
本システムでは、未登録ユーザーと会員ユーザーがシームレスに混在するため、3つの認証ヘッダー／Cookieを併用する。

| 認証種別 | 伝達経路 | 対象アクター | 検証方式 |
| :--- | :--- | :--- | :--- |
| **会員セッション** | `Authorization: Bearer <JWT>` または `Cookie: session_token` | 会員参加者 / 会員幹事 | 会員ID（`user_id`）の復号・検証 |
| **ゲスト幹事トークン** | `X-Guest-Organizer-Token: <PlainToken>` | ゲスト幹事 | SHA-256ハッシュ化し `events.guest_organizer_token_hash` と突合 |
| **参加者端末トークン** | `Cookie: rsvp_token=<PlainToken>` または `X-RSVP-Token: <PlainToken>` | ゲスト参加者 | SHA-256ハッシュ化し `participants.response_token_hash` と突合 |
| **編集排他トークン** | `X-Lock-Token: <LockToken>` | イベント編集中幹事 | `edit_locks.locked_by_token` かつ `expires_at > NOW()` を検証 |

### 1.3. エラーレスポンス規約 (RFC 7807 準拠)
すべてのエラーレスポンスは以下の共通JSONスキーマで返却する。

```json
{
  "type": "https://api.example.com/errors/CONFLICT_LOCK",
  "title": "Conflict Lock",
  "status": 409,
  "detail": "他の幹事が編集中です。",
  "instance": "/api/v1/organizer/events/550e8400-e29b-41d4-a716-446655440000/lock",
  "errors": {
    "holder_name": "田中（共同幹事）",
    "expires_at": "2026-10-18T03:21:45.000Z",
    "remaining_seconds": 135
  }
}
```

---

## 2. エンドポイント一覧（API Summary）

```
[公開・参加者向け]
  GET    /api/v1/public/events/:id               - イベント詳細取得（参加者非公開）
  POST   /api/v1/public/events/:id/rsvp          - ゼロフリクション出欠登録
  GET    /api/v1/public/events/:id/my-rsvp       - 自身の出欠回答の自動照会
  PUT    /api/v1/public/events/:id/my-rsvp       - 自身の出欠回答の変更

[イベント作成]
  POST   /api/v1/public/events                   - イベント新規作成（スキップ/会員対応）

[幹事管理機能]
  GET    /api/v1/organizer/events/:id/participants - 参加者一覧取得（幹事専用）
  PUT    /api/v1/organizer/events/:id              - イベント基本情報の更新
  POST   /api/v1/organizer/events/:id/invite       - 共同幹事招待コード発行
  POST   /api/v1/organizer/events/join-by-invite   - 共同幹事招待の受託

[排他リースロック]
  POST   /api/v1/organizer/events/:id/lock          - 編集権ロック取得（180秒TTL）
  PUT    /api/v1/organizer/events/:id/lock          - ロック延長ハートビート
  POST   /api/v1/organizer/events/:id/lock/takeover - ロック強制引き継ぎ
  DELETE /api/v1/organizer/events/:id/lock          - ロック明示解放

[会員・マイページ]
  POST   /api/v1/member/hydrate                    - 端末履歴のアカウント統合
  GET    /api/v1/member/organized-events           - 主催イベント一覧取得
  POST   /api/v1/member/organized-events/:id/clone - 過去イベント複製
  GET    /api/v1/member/attended-events            - 参加履歴一覧取得
```

---

## 3. 詳細API仕様書

### 3.1. 公開・参加者向けAPI

#### `GET /api/v1/public/events/:id`
イベントの一般公開詳細情報を取得する。**参加者個人情報（氏名・出欠・コメント）は一切返却しない。**

* **URL Parameters:** `id` (UUID) - イベントID
* **Headers:** 不要
* **Response (200 OK):**
```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "title": "第12回 UI/UXデザイントーク勉強会",
  "description": "デザインシステムと実装の乖離を埋めるLT大会です。",
  "event_start_at": "2026-11-05T19:00:00.000Z",
  "location": "東京都渋谷区道玄坂1丁目 / オンライン配信あり",
  "summary": {
    "total_participants": 24,
    "attending_count": 18,
    "declined_count": 3,
    "tentative_count": 3
  }
}
```

---

#### `POST /api/v1/public/events/:id/rsvp`
会員登録不要で出欠を登録する。登録完了後、端末照会用のCookieを発行する。

* **URL Parameters:** `id` (UUID) - イベントID
* **Request Body:**
```json
{
  "name": "佐藤 健一",
  "status": "ATTENDING",
  "comment": "10分ほど遅れて参加します。"
}
```
* **Validation:**
  * `name`: string, min: 1, max: 100, 必須
  * `status`: enum `["ATTENDING", "DECLINED", "TENTATIVE"]`, 必須
  * `comment`: string, max: 255, 任意
* **Response (201 Created):**
  * **Set-Cookie Header:**
    `rsvp_token=pt_a8f9c0e2...; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=2592000` (30日間有効)
```json
{
  "participant_id": "771e8400-e29b-41d4-a716-446655440111",
  "event_id": "550e8400-e29b-41d4-a716-446655440000",
  "name": "佐藤 健一",
  "status": "ATTENDING",
  "comment": "10分ほど遅れて参加します。",
  "response_token": "pt_a8f9c0e2..." 
}
```
*(※クライアントがCookie非対応環境/ネイティブアプリの場合を考慮し、ボディでも `response_token` を返却)*

---

#### `GET /api/v1/public/events/:id/my-rsvp`
保持しているCookie（またはヘッダー）から、同一端末で登録した自身の回答状態を自動照会する。

* **URL Parameters:** `id` (UUID) - イベントID
* **Headers / Cookies:**
  * `Cookie: rsvp_token=<token>` または `X-RSVP-Token: <token>`
* **Response (200 OK):**
```json
{
  "is_registered": true,
  "participant": {
    "id": "771e8400-e29b-41d4-a716-446655440111",
    "name": "佐藤 健一",
    "status": "ATTENDING",
    "comment": "10分ほど遅れて参加します。",
    "updated_at": "2026-10-18T03:00:00.000Z"
  }
}
```
* **Response (404 Not Found):** 当該端末からの回答が存在しない（新規回答フォームを表示するフラグ）
```json
{
  "is_registered": false,
  "participant": null
}
```

---

#### `PUT /api/v1/public/events/:id/my-rsvp`
自身の出欠ステータスやコメントを変更する。

* **Headers / Cookies:**
  * `Cookie: rsvp_token=<token>` または `X-RSVP-Token: <token>`
* **Request Body:**
```json
{
  "name": "佐藤 健一",
  "status": "DECLINED",
  "comment": "急遽都合がつかなくなりました。申し訳ありません。"
}
```
* **Response (200 OK):**
```json
{
  "success": true,
  "updated_at": "2026-10-18T03:45:00.000Z"
}
```

---

### 3.2. イベント作成API

#### `POST /api/v1/public/events`
イベントを新規作成する。未登録のまま作成（ゲスト幹事）またはログイン状態での作成（会員幹事）の双方を同一エンドポイントで処理する。

* **Headers:**
  * `Authorization: Bearer <JWT>`（会員作成時のみ・任意）
* **Request Body:**
```json
{
  "title": "秋の懇親バーベキュー会",
  "description": "会費は現地集金です。",
  "event_start_at": "2026-10-25T12:00:00.000Z",
  "location": "代々木公園 BBQエリア",
  "guest_organizer_name": "幹事 鈴木"
}
```
* **処理ロジック:**
  * `Authorization` なし（ゲスト作成）:
    * ゲスト用秘密トークン `PlainToken`（NanoID 21文字）を生成。
    * SHA-256でハッシュ化し `events.guest_organizer_token_hash` に保存。
    * レスポンスCookieに `organizer_token` を付与し、管理ケイパビリティURLを返却。
  * `Authorization` あり（会員作成）:
    * `events` レコード作成後、`event_organizers` テーブルに `role: 'OWNER'` としてインサート。
* **Response (201 Created):**
  * **Set-Cookie Header (ゲスト時のみ):**
    `guest_organizer_token=got_7x9a...; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=2592000`
```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "title": "秋の懇親バーベキュー会",
  "is_guest": true,
  "manage_url": "/manage/events/550e8400-e29b-41d4-a716-446655440000?token=got_7x9a...",
  "guest_organizer_token": "got_7x9a..."
}
```

---

### 3.3. 幹事専用・管理API

#### `GET /api/v1/organizer/events/:id/participants`
幹事のみが閲覧可能な参加者一覧を取得する。参加者からのアクセスは `403 Forbidden` で弾く。

* **Headers:**
  * `Authorization: Bearer <JWT>` または `X-Guest-Organizer-Token: <token>`
* **Response (200 OK):**
```json
{
  "event_id": "550e8400-e29b-41d4-a716-446655440000",
  "total_count": 2,
  "participants": [
    {
      "id": "771e8400-e29b-41d4-a716-446655440111",
      "name": "佐藤 健一",
      "status": "ATTENDING",
      "comment": "10分ほど遅れて参加します。",
      "is_registered_user": true,
      "created_at": "2026-10-18T03:00:00.000Z"
    },
    {
      "id": "882e8400-e29b-41d4-a716-446655440222",
      "name": "山田（ゲスト）",
      "status": "TENTATIVE",
      "comment": "調整中",
      "is_registered_user": false,
      "created_at": "2026-10-18T03:15:00.000Z"
    }
  ]
}
```

---

#### `PUT /api/v1/organizer/events/:id`
イベント情報を更新する。**有効な編集ロックトークン（`X-Lock-Token`）の提示が必須。**

* **Headers:**
  * `Authorization: Bearer <JWT>` または `X-Guest-Organizer-Token: <token>`
  * `X-Lock-Token: lk_3b9f...`（必須）
* **Request Body:**
```json
{
  "title": "秋の懇親バーベキュー会（雨天時会場変更あり）",
  "description": "雨天時は近くの室内パーティールームに変更します。",
  "event_start_at": "2026-10-25T13:00:00.000Z",
  "location": "代々木公園 BBQエリア / 雨天時: 渋谷レンタルルーム"
}
```
* **Response (200 OK):**
```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "updated_at": "2026-10-18T03:30:00.000Z"
}
```
* **Response (423 Locked / 409 Conflict):** 有効なロックトークンがない場合
```json
{
  "type": "https://api.example.com/errors/INVALID_LOCK_TOKEN",
  "title": "Lock Token Invalid or Expired",
  "status": 423,
  "detail": "編集権を保持していないか、ロックの有効期限（180秒）が切れています。"
}
```

---

#### `POST /api/v1/organizer/events/:id/invite`
共同幹事用の招待URL（招待コード）を発行する。

* **Headers:** 幹事認証ヘッダー必須
* **Response (200 OK):**
```json
{
  "invite_code": "inv_88c7d6e5...",
  "invite_url": "https://example.com/events/join-organizer?invite_code=inv_88c7d6e5...",
  "created_at": "2026-10-18T03:00:00.000Z"
}
```

---

#### `POST /api/v1/organizer/events/join-by-invite`
招待リンクを踏んだユーザーが共同幹事として参加登録する。

* **Headers:** `Authorization: Bearer <JWT>`（会員時）
* **Request Body:**
```json
{
  "invite_code": "inv_88c7d6e5..."
}
```
* **処理ロジック:**
  * `invite_code` をハッシュ化して対象 `events` を特定。
  * 会員ログイン状態であれば `event_organizers` テーブルに `role: 'CO_ORGANIZER'` をインサート。
  * 未登録であれば、ゲスト幹事トークンを発行してCookieに保存。
* **Response (200 OK):**
```json
{
  "event_id": "550e8400-e29b-41d4-a716-446655440000",
  "role": "CO_ORGANIZER",
  "message": "共同幹事に登録されました。"
}
```

---

### 3.4. 排他リースロックAPI（同時編集不可）

#### `POST /api/v1/organizer/events/:id/lock`
編集画面入場時に編集ロックを獲得する（リースTTL: 180秒）。

* **Headers:** 幹事認証ヘッダー必須
* **Request Body:**
```json
{
  "holder_name": "田中 幹事"
}
```
* **Response (200 OK - ロック獲得成功):**
```json
{
  "locked": true,
  "lock_token": "lk_3b9f8d1c...",
  "expires_at": "2026-10-18T03:23:00.000Z",
  "ttl_seconds": 180
}
```
* **Response (409 Conflict - 他幹事がロック保持中):**
```json
{
  "locked": false,
  "holder_name": "鈴木（共同幹事）",
  "expires_at": "2026-10-18T03:22:15.000Z",
  "remaining_seconds": 95,
  "can_takeover": true,
  "message": "現在、他の幹事が編集中です。閲覧モードで開きます。"
}
```

---

#### `PUT /api/v1/organizer/events/:id/lock`
編集画面を開いている間、フロントエンドから30秒毎に送信してTTLを再延長（180秒に戻す）するハートビートAPI。

* **Headers:** 幹事認証ヘッダー必須
* **Request Body:**
```json
{
  "lock_token": "lk_3b9f8d1c..."
}
```
* **Response (200 OK):**
```json
{
  "extended": true,
  "expires_at": "2026-10-18T03:26:00.000Z",
  "ttl_seconds": 180
}
```
* **Response (409 Conflict):** 他幹事によりTakeoverされたか期限切れで回収された場合
```json
{
  "extended": false,
  "message": "編集ロックが失効しました。他幹事が編集を引き継いだ可能性があります。"
}
```

---

#### `POST /api/v1/organizer/events/:id/lock/takeover`
他幹事の編集権を強制的に引き継ぎ（破棄）し、自身に新たなロックを付与する。

* **Headers:** 幹事認証ヘッダー必須
* **Request Body:**
```json
{
  "holder_name": "田中 幹事"
}
```
* **Response (200 OK):**
```json
{
  "locked": true,
  "lock_token": "lk_99a1b2c3...",
  "expires_at": "2026-10-18T03:26:30.000Z",
  "ttl_seconds": 180,
  "message": "編集権を強制的に引き継ぎました。"
}
```

---

#### `DELETE /api/v1/organizer/events/:id/lock`
保存完了時または編集画面キャンセル・離脱時にロックを明示解放する。

* **Headers:**
  * 幹事認証ヘッダー必須
  * `X-Lock-Token: lk_3b9f8d1c...`
* **Response (204 No Content)**

---

### 3.5. 会員・マイページAPI

#### `POST /api/v1/member/hydrate`
ゲストとして蓄積された端末の「参加回答トークン」および「ゲスト幹事トークン」を、新規作成した会員アカウントに一括統合する。

* **Headers:** `Authorization: Bearer <JWT>`（会員認証必須）
* **Request Body:**
```json
{
  "response_tokens": [
    "pt_a8f9c0e2...",
    "pt_11b2c3d4..."
  ],
  "guest_organizer_tokens": [
    "got_7x9a..."
  ]
}
```
* **Response (200 OK):**
```json
{
  "hydrated_participations_count": 2,
  "hydrated_organized_events_count": 1,
  "message": "過去の参加および主催イベントの統合が完了しました。"
}
```

---

#### `GET /api/v1/member/organized-events`
自身が主催・共同主催しているイベント一覧を取得する。

* **Headers:** `Authorization: Bearer <JWT>`（会員認証必須）
* **Response (200 OK):**
```json
{
  "events": [
    {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "title": "秋の懇親バーベキュー会",
      "role": "OWNER",
      "event_start_at": "2026-10-25T12:00:00.000Z",
      "participants_count": 14,
      "created_at": "2026-10-15T08:00:00.000Z"
    }
  ]
}
```

---

#### `POST /api/v1/member/organized-events/:id/clone`
過去の主催イベントの設定（タイトル・場所・説明等）をコピーして新規イベントを作成する。参加者リストやロック情報は除外される。

* **URL Parameters:** `id` (UUID) - コピー元イベントID
* **Headers:** `Authorization: Bearer <JWT>`（会員認証必須）
* **Response (201 Created):**
```json
{
  "new_event_id": "990a1234-e29b-41d4-a716-446655440999",
  "title": "秋の懇親バーベキュー会 のコピー",
  "description": "会費は現地集金です。",
  "location": "代々木公園 BBQエリア",
  "event_start_at": null,
  "message": "イベントを複製しました。日時を設定して公開してください。"
}
```

---

#### `GET /api/v1/member/attended-events`
会員自身が参加・回答したイベントの履歴一覧を取得する。

* **Headers:** `Authorization: Bearer <JWT>`（会員認証必須）
* **Response (200 OK):**
```json
{
  "attended_events": [
    {
      "event_id": "550e8400-e29b-41d4-a716-446655440000",
      "event_title": "第12回 UI/UXデザイントーク勉強会",
      "event_start_at": "2026-11-05T19:00:00.000Z",
      "my_status": "ATTENDING",
      "my_comment": "10分ほど遅れて参加します。",
      "registered_at": "2026-10-18T03:00:00.000Z"
    }
  ]
}
```

---

## 4. ミドルウェア・ガード実装仕様

バックエンドフレームワーク（Next.js Route Handlers / Express / Fastify / NestJS等）で共通利用するガードロジックの定義である。

### 4.1. トークンハッシュ化ユーティリティ (`hashUtils.ts`)
```typescript
import { createHash } from "node:crypto";

export function sha256(plainToken: string): string {
  return createHash("sha256").update(plainToken).digest("hex");
}
```

### 4.2. 幹事認可ガード (`assertOrganizerGuard`)
```typescript
import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { sha256 } from "@/lib/hashUtils";

export async function assertOrganizer(req: NextRequest, eventId: string, currentUserId?: string) {
  // 1. 会員ログイン状態の場合、event_organizers を検証
  if (currentUserId) {
    const isMemberOrganizer = await prisma.eventOrganizer.findUnique({
      where: {
        eventId_userId: { eventId, userId: currentUserId }
      }
    });
    if (isMemberOrganizer) return true;
  }

  // 2. ゲスト幹事トークンを検証
  const plainGuestToken = req.headers.get("x-guest-organizer-token") || req.cookies.get("guest_organizer_token")?.value;
  if (plainGuestToken) {
    const tokenHash = sha256(plainGuestToken);
    const event = await prisma.event.findFirst({
      where: { id: eventId, guestOrganizerTokenHash: tokenHash }
    });
    if (event) return true;
  }

  throw new Error("FORBIDDEN_NOT_ORGANIZER");
}
```

### 4.3. 排他ロック検証ガード (`assertLockGuard`)
```typescript
export async function assertLockHolder(req: NextRequest, eventId: string) {
  const lockToken = req.headers.get("x-lock-token");
  if (!lockToken) {
    throw new Error("LOCK_TOKEN_REQUIRED");
  }

  const activeLock = await prisma.editLock.findFirst({
    where: {
      eventId: eventId,
      lockedByToken: lockToken,
      expiresAt: { gt: new Date() } // 有効期限内
    }
  });

  if (!activeLock) {
    throw new Error("LOCK_INVALID_OR_EXPIRED");
  }

  return activeLock;
}
```

---

## 5. 実装プロンプト用指示テンプレート（AI自動実装用）

AIコードジェネレーター（Cursor, GitHub Copilot, Claude Engineer等）へAPIエンドポイントの実装を命じる際は、本仕様書およびDB定義書をコンテキストに含め、以下のプロンプト構文を使用する。

```text
あなたはTypeScriptとPrisma/Next.js App Routerのシニアエンジニアです。
添付された「データベース物理設計・スキーマ定義書」および「API設計・実装仕様書」に基づき、
以下のAPIルートハンドラーを実装してください。

【対象API】
- POST /api/v1/organizer/events/[id]/lock (ロック取得)
- PUT  /api/v1/organizer/events/[id]/lock (ハートビート)
- POST /api/v1/organizer/events/[id]/lock/takeover (強制引き継ぎ)

【実装要件】
1. トランザクションまたは raw SQL (ON CONFLICT DO UPDATE WHERE expires_at <= NOW()) を利用して二重ロックを防止すること。
2. 幹事認可ガード (assertOrganizer) を通過したリクエストのみ受け付けること。
3. エラー時は RFC 7807 形式の JSON を返却すること。
4. TypeScriptの型安全性を徹底し、入力バリデーションには Zod を使用すること。
```