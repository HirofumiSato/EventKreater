# データベース物理設計書（DBschema.md）

## イベント紹介ページ生成・出欠管理 ＆ チケット・課金決済基盤 統合データベース仕様書

## 1. 全体アーキテクチャ・設計方針

本ドキュメントは、「イベント紹介ページ生成＆出欠管理基盤」「チケット管理＆課金決済基盤（Stripe連携）」「ユーザー登録（ローカルパスワードと Google サインイン）」「チラシ生成結果の保存」を一つのデータベース物理設計書にまとめたものである。概念データモデル（CDM）、論理データモデル（LDM）、物理データモデル（PDM）、Prismaスキーマ、および各エンティティのCRUD操作トランザクション仕様を網羅する。チラシ生成の途中状態（プロンプト、背景画像、フォールバック判定）は本データベースには持たない。生成サービスが返した JPEG をファイルとして保存し、その所在だけを `flyer_assets` に記録する。

### 1.1. 5大設計基本方針

1. **ハイブリッド・アイデンティティ（段階的会員化）のデータ吸収:**
   - 「未登録（端末Cookie依存）」「ゲスト幹事（暗号化トークン所持）」「認証済み会員（User ID保持）」という3つの利用形態を、単一スキーマ体系で一貫して保持する。
2. **暗号学的トークンハッシュ化によるゼロトラスト設計:**
   - ゲスト幹事トークン、出欠照会トークン、共同主催・幹事の招待コードは、DB内に平文で保存せず、すべてSHA-256ハッシュ値として保存する。
3. **PostgreSQL固有のアトミック排他制御（Pessimistic Lease Lock）:**
   - 共同主催・幹事の同時編集事故（Lost Update）を防ぐため、外部キャッシュ（Redis等）を用いず、PostgreSQLの `ON CONFLICT DO UPDATE WHERE lock_token_hash = :currentLockTokenHash` 構文を活用してDB単体で厳密な原子性を担保する。ロックは時間で失効させず、保持者が解放するか他の幹事が引き継ぐまで保持する。
4. **マネタイズ基盤（課金クォータ・Stripe連携）の完全統合:**
   - 主催者のチケット（累計2枚無料、単発299円クレジット、8件まで公開プラン980円・公開し放題プラン2980円のサブスクリプション）を `user_usage_quotas` テーブルで管理。定額プランの上限は暦月の公開件数ではなく、公開中のイベント数（`events.quota_source = 'SUBSCRIPTION'` かつ開催日が今日以降）で判定する。
   - 決済監査ログ（`billing_transactions`）および Webhook冪等性制御（`stripe_webhook_events`）を統合し、二重課金・二重付与を物理遮断する。
5. **主催者のみチケット消費ルール:**
   - イベントを複数幹事で共同運営する場合でも、クォータを消費するのは主催者（OWNER）のみとし、招待された共同主催・幹事（CO_HOST）のチケットは消費しない。

---

## 2. 概念データモデル（Conceptual Data Model: CDM）

### 2.1. コア概念（Entities）の抽出と役割

* **User (認証済み会員):** 確認済み電話番号（E.164）で人物を一意にする会員。メールアドレスと Google の `sub` はログイン手段である。パスワードだけの会員は `passwordHash` を持ち `googleSub` は空。Google だけの会員は `googleSub` を持ち `passwordHash` は空。同じ確認済みメールの会員が後から Google で入ったときは、既存行へ `googleSub` を結ぶ。同じ確認済み電話番号の会員が別メールや別 Google で入ったときも、新しい行は作らずその会員へ手段を足す。パスワード登録は確認メールのあと、電話番号確認が終わるまで会員行を作らない。プラットフォーム全体の権限は `platformRole`（`MEMBER` / `ADMIN`）であり、イベント単位の幹事ロールとは別である。公開登録の初期値は `MEMBER` である。ログイン中のセッションは `auth_sessions`、確認メールのトークンハッシュは `email_verification_tokens`、登録意向は `signup_intents`、SMS 確認コードのハッシュは `phone_verification_codes`、ログイン確認番号のハッシュは `login_challenges`、試行回数とログインロックの開始時刻は `auth_attempts` に置く。確認番号の失敗が 10 回に達した会員は 15 分ロックする。
* **SignupIntent (登録意向):** メール確認または Google 確認のあと、電話番号確認が終わるまでの一時行。会員行とチケット情報はまだ無い。
* **UserUsageQuota (チケット情報):** 主催者のイベント公開チケット（無料チケットの消化枚数、単発クレジット残数、サブスク状態、Stripe連携情報）を管理。
* **BillingTransaction (課金決済履歴):** チケットの単発購入、月額の初回 Checkout、月額の更新請求、失敗、全額返金、異議申立の監査ログ。管理者の一覧は SCR-ADM-03。参加費の集金記録とは別である。
* **StripeWebhookEvent (Webhook冪等性ログ):** Stripeから受信・処理したWebhook Event IDを記録し、重複処理を防止。
* **Event (イベント本体):** 主催者が告知・出欠を集めるイベントの実体（基本7項目＋ステータス＋掲載フラグ＋任意の申し込み期限）。`visibility` は将来のメディアサイト用の予約列であり、いまのアプリは一覧を持たないため常に `UNLISTED`（紹介制）。
* **Receipt (参加費の領収書・旧):** 旧画面で幹事が出席者へ発行した文書。1参加者につき1件。金額は幹事の入力で、参加費の決済は持たない。**画面からは外した**（参加者向け・主催者向けの領収書画面を廃止）。既存データの保護と `GET /api/v1/user/hydrate` の会員統合が参照するため残し、新しい書き込みはしない。今後は `participants.collected_at` で集金を記録する。
* **FlyerAsset (チラシ画像アセット):** チラシ生成 API が保存した A4 縦（1080×1528）の JPEG、または主催者がアップロードした完成済みの画像。`imageUrl` は `GET /api/v1/flyer-assets/{id}/image` を指し、バイト列そのものは生成なら `storage/flyers/{id}.jpg`、アップロードなら `storage/flyers/{id}.{jpg|png|webp}` に置く。アップロードは再エンコードせず、`aspectRatio` は `auto`、`externalFlyerId` は NULL になる。ダウンロード用の A4 PDF と告知ページの QR は保存せず、`GET /api/v1/flyer-assets/{id}/pdf` が要求のたびに作る。チラシなしのイベントも許容する。
* **EventOrganizer (幹事権限):** イベントと主催者を結ぶ多対多エンティティ。OWNER（主催者。1イベント1行）と CO_HOST（共同主催・幹事）を識別する。会員は `User.name` を表示名に使い、ゲストは `display_name` を使う。
* **ImageAsset (会員が上げた画像):** プロフィールのアイコンやヘッダーなど、会員がアップロードした画像の実体。1行1画像で、バイト列は `storage/images/{id}.webp` に置き、`GET /api/v1/image-assets/{id}/image` で配る。参照する側（`organizer_profiles.avatar_image_id` / `organizer_profiles.header_image_id`、将来は `events.cover_image_id`）に外部キーを置く。用途（`kind`）は `AVATAR` / `EVENT_COVER` / `PROFILE_HEADER` の3つで、列挙型にせずアプリ側で検証する。
* **Participant (参加者・出欠):** 参加者の出欠登録実体。未登録時は端末Cookieトークンで紐付け。集金は `collectedAt`（`collected_at`）で持ち、NULL は未集金。金額は `priceAmount` から割引を引いた額（0 円で止める）× `partySize` で、手入力はしない。
* **EventLock (排他編集ロック):** 主催者と共同主催・幹事の間の同時編集競合を防止する排他編集ロック。保持者が解放するか、他の幹事が引き継ぐまで保持され、時間では失効しない。
* **EventInvitation (共同主催・幹事の招待):** 既存幹事が他の会員を共同主催・幹事として迎えるためのワンタイム招待実体。受諾は会員のみ。

### 2.2. 概念ER図

```mermaid
erDiagram
    Users ||--o{ BillingTransaction : "決済履歴 1 対 0..*"
    Users ||--|| UserUsageQuota : "チケット 1 対 1"
    Users ||--o{ LoginChallenge : "ログイン確認 1 対 0..*"
    Users ||--o{ EventOrganizers : "幹事 1 対 0..*"
    EventOrganizers }o--|| Events : "管理対象 0..* 対 1"
    Events ||--o| FlyerAsset : "チラシ 1 対 0..1"
    Events ||--o| EventLock : "排他ロック 1 対 0..1"
    Events ||--o{ EventInvitation : "共同主催・幹事の招待 1 対 0..*"
    Events ||--o{ Participant : "出欠 1 対 0..*"
    Users {
        string role "会員基盤"
    }
    BillingTransaction {
        string role "決済履歴"
    }
    UserUsageQuota {
        string role "チケット・Stripe"
    }
    EventOrganizers {
        string role "幹事権限 OWNER / CO_HOST"
    }
    Events {
        string role "イベント本体"
    }
    FlyerAsset {
        string role "チラシ画像アセット"
    }
    EventLock {
        string role "排他編集ロック"
    }
    EventInvitation {
        string role "共同主催・幹事の招待"
    }
    Participant {
        string role "参加者出欠"
    }
    LoginChallenge {
        string role "ログイン確認番号"
    }
    StripeWebhookEvent {
        string role "Webhook冪等性。他エンティティとFKを持たない"
    }
```

---

## 3. 論理データモデル（Logical Data Model: LDM）

### 3.1. 正規化（第1〜第3正規形）の適用

* **第1正規形 (1NF):** `event_date` (DATE) と `event_time` (VARCHAR) を分離。ステータスや雨天対応、決済方式を列挙型（ENUM）で独立定義し、アトミック値を保証。
* **第2正規形 (2NF):** `EventOrganizer` をサロゲートキーで独立させ、複合キーによる部分関数従属を排除。
* **第3正規形 (3NF):**
  * 課金・チケット情報（`UserUsageQuota`）および決済ログ（`BillingTransaction`）を `User` から完全に分離。
  * 出欠人数（参加確定数等）は集計クエリとして導出し、物理テーブルへの二重保持による更新不整合を防止。

### 3.2. 列挙型（ENUM）定義一覧

| 列挙型名 | 定義値 | 概要 |
| :---- | :---- | :---- |
| **SubscriptionStatus** | `NONE`, `ACTIVE`, `PAST_DUE`, `CANCELED`, `INCOMPLETE` | サブスクリプション契約状態 |
| **SubscriptionPlan** | `NONE`, `MONTHLY_8`, `UNLIMITED` | 加入中の定額プラン（8件まで公開プラン980円 / 公開し放題プラン2980円 / 未加入） |
| **QuotaSource** | `FREE_TRIAL`, `PAID_CREDIT`, `SUBSCRIPTION` | イベントを公開したときのチケット。公開中の件数に数えるのは `SUBSCRIPTION` だけ |
| **PaymentType** | `ONE_TIME`, `SUBSCRIPTION` | 決済種別（単発299円 / 月額） |
| **PaymentStatus** | `PENDING`, `SUCCEEDED`, `FAILED`, `REFUNDED`, `DISPUTED` | 決済ステータス。`DISPUTED` は異議申立 |
| **RainPolicy** | `RAIN_OR_SHINE`, `CANCEL_ON_RAIN`, `POSTPONE_ON_RAIN`, `INDOOR` | 雨天時の催行方針 |
| **EventStatus** | `DRAFT`, `PUBLISHED`, `CLOSED` | イベント公開状態 |
| **EventVisibility** | `PUBLIC`, `UNLISTED` | 将来のメディアサイト向けの掲載フラグ。`PUBLIC` は一覧掲載、`UNLISTED` は紹介制。いまのアプリは常に `UNLISTED` |
| **OrganizerRole** | `OWNER`, `CO_HOST` | 幹事ロール（主催者 / 共同主催・幹事）。イベント単位 |
| **RevenueSplitMode** | `RATIO`, `HEADCOUNT` | 売上の按分方式。割合（basis points）か、連れてきた人数か |
| **RevenueShareVisibility** | `ALL`, `OWN_ONLY` | 按分の閲覧範囲。`OWN_ONLY` は共同主催・幹事に自分の行だけを見せる |
| **PlatformRole** | `MEMBER`, `ADMIN` | プラットフォーム権限。会員行に1つ。既定は `MEMBER` |
| **LoginChallengeChannel** | `SMS`, `EMAIL` | ログイン確認番号の届け方。既定は一般会員が `EMAIL`、管理者の入口が `SMS` |
| **LoginChallengePurpose** | `MEMBER`, `ADMIN`, `PARTICIPANT` | 主催者入口か管理者入口か参加者入口か。`PARTICIPANT` は管理者も通り抜けられる |
| **SignupAudience** | `ORGANIZER`, `PARTICIPANT` | 登録を始めた入口。確認メール後の着地を分ける。既定は `ORGANIZER` |
| **PricingTarget** | `ONE_TIME`, `SUBSCRIPTION`, `SUBSCRIPTION_8`, `SUBSCRIPTION_UNLIMITED`, `BOTH` | 価格キャンペーンの適用対象（`SUBSCRIPTION` は定額2階層の両方、`BOTH` は単発と定額すべて） |
| **DiscountKind** | `PERCENT`, `FREE` | 割引の種類。`FREE` は `percent = 100` の別名 |
| **BillingNoticeKind** | `FREE_PERIOD_ENDING_3D`, `FREE_PERIOD_ENDING_1D` | 0 円月額の終了前に送る案内の種別 |
| **RsvpStatus** | `ATTENDING`, `DECLINED` | 出欠意思表示（参加 / 不参加） |
| **NotificationKind** | `RSVP_ATTENDING`, `RSVP_WAITLISTED`, `REFERRAL_GRANTED` | 主催者へ届けるアプリ内通知の種別（出席の表明 / 参加要望 / 紹介でのチケット付与）。欠席と取り消しは通知しない。`REFERRAL_GRANTED` は催しに紐づかない |
| **FreeTicketSource** | `AD`, `REFERRAL`, `MANUAL` | 期限つきの無料チケットの発行元（動画の視聴 / 紹介 / 運営の付与）。動画（`AD`）は未実装 |
| **AccountChangeKind** | `NAME`, `EMAIL`, `PHONE`, `PASSWORD`, `WITHDRAW`, `REACTIVATE` | 会員が自分の情報を変えた種別。`WITHDRAW` は退会、`REACTIVATE` は退会済み行の復帰 |

---

## 4. 物理データモデル（Physical Data Model: PDM）

### 4.1. Prisma スキーマ完全定義 (`schema.prisma`)

```text
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

generator client {
  provider = "prisma-client-js"
}

// =============================================================
// ENUM 定義
// =============================================================
enum SubscriptionStatus {
  NONE
  ACTIVE
  PAST_DUE
  CANCELED
  INCOMPLETE
}

enum PaymentType {
  ONE_TIME
  SUBSCRIPTION
}

enum PaymentStatus {
  PENDING
  SUCCEEDED
  FAILED
  REFUNDED
  DISPUTED
}

enum RainPolicy {
  RAIN_OR_SHINE     // 雨天決行
  CANCEL_ON_RAIN    // 雨天中止
  POSTPONE_ON_RAIN  // 雨天順延
  INDOOR            // 屋内開催
}

enum EventStatus {
  DRAFT       // 下書き
  PUBLISHED   // 公開中（受付中）
  CLOSED      // 終了・締切
}

enum EventVisibility {
  PUBLIC    // 一覧掲載（将来のメディアサイト用。いまは保存しない）
  UNLISTED  // 紹介制（URL直開きのみ）。いまの唯一の値
}

enum OrganizerRole {
  OWNER    // 主催者（チケット消費対象）
  CO_HOST  // 共同主催・幹事（チケット消費なし）
}

enum RsvpStatus {
  ATTENDING // 参加
  DECLINED  // 不参加
}

enum PlatformRole {
  MEMBER // 一般会員。公開登録の既定
  ADMIN  // プラットフォーム管理者
}

enum LoginChallengeChannel {
  SMS
  EMAIL
}

enum LoginChallengePurpose {
  MEMBER
  ADMIN
  /// 参加者向けの入口（/participant/login）。管理者も参加者として通り抜けられる。
  PARTICIPANT
}

/// 会員登録を始めた入口。確認メールのあとの着地を分けるために保持する。
enum SignupAudience {
  ORGANIZER
  PARTICIPANT
}

// =============================================================
// 1. ユーザー＆会員基盤
// =============================================================
model User {
  id           String   @id @default(uuid()) @db.Uuid
  email        String   @unique @db.VarChar(255)
  name         String   @db.VarChar(50)
  /// ローカル会員認証用。Google のみのユーザーは NULL。
  passwordHash String?  @map("password_hash") @db.VarChar(255)
  /// Google アカウントの sub。
  googleSub    String?  @unique @map("google_sub") @db.VarChar(255)
  /// 公開登録では常に MEMBER。ADMIN は DB または管理コンソールから付与する。
  platformRole PlatformRole @default(MEMBER) @map("platform_role")
  /// パスワード登録は確認メールのリンクを開くまで NULL。Google は確認済みメールだけで進む。
  emailVerifiedAt DateTime? @map("email_verified_at") @db.Timestamptz
  /// 確認済みの電話番号（E.164）。未確認の番号は入れない。NULL は複数行で共存できる。
  phoneE164       String?   @unique @map("phone_e164") @db.VarChar(20)
  phoneVerifiedAt DateTime? @map("phone_verified_at") @db.Timestamptz
  /// 退会（論理削除）の日時。NULL は在籍。電話番号は退会後も残し、再登録の突き合わせに使う。
  deletedAt       DateTime? @map("deleted_at") @db.Timestamptz
  createdAt    DateTime @default(now()) @map("created_at") @db.Timestamptz
  updatedAt    DateTime @updatedAt @map("updated_at") @db.Timestamptz
  quota         UserUsageQuota?
  transactions  BillingTransaction[]
  organizers    EventOrganizer[]
  participants  Participant[]
  locks         EventLock[]
  loginChallenges LoginChallenge[]
  accountChangeLogs   AccountChangeLog[]
  emailChangeRequests EmailChangeRequest[]
  @@index([deletedAt])
  @@map("users")
}

/// 会員が自分の情報を変えた記録。値はマスク済みのものだけを残し、パスワードは入れない。
model AccountChangeLog {
  id          String            @id @default(uuid()) @db.Uuid
  userId      String?           @map("user_id") @db.Uuid
  kind        AccountChangeKind
  /// 変更前の値（メールはマスク、電話は下4桁）。パスワードは NULL。
  beforeValue String?           @map("before_value") @db.VarChar(255)
  /// 変更後の値（同じ規則）。退会・復帰は NULL。
  afterValue  String?           @map("after_value") @db.VarChar(255)
  ipHash      String?           @map("ip_hash") @db.VarChar(64)
  createdAt   DateTime          @default(now()) @map("created_at") @db.Timestamptz

  user User? @relation(fields: [userId], references: [id], onDelete: SetNull)

  @@index([userId, createdAt])
  @@map("account_change_logs")
}

/// メールアドレス変更の保留中。新しいアドレスに届いたリンクを開くと確定する。
model EmailChangeRequest {
  id        String    @id @default(uuid()) @db.Uuid
  userId    String    @map("user_id") @db.Uuid
  newEmail  String    @map("new_email") @db.VarChar(255)
  tokenHash String    @unique @map("token_hash") @db.VarChar(64)
  expiresAt DateTime  @map("expires_at") @db.Timestamptz
  usedAt    DateTime? @map("used_at") @db.Timestamptz
  createdAt DateTime  @default(now()) @map("created_at") @db.Timestamptz

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId])
  @@map("email_change_requests")
}

/// メール確認または Google 確認のあと、電話番号確認で会員になるまでの意向。
model SignupIntent {
  id              String    @id @default(uuid()) @db.Uuid
  email           String    @db.VarChar(255)
  name            String    @db.VarChar(50)
  passwordHash    String?   @map("password_hash") @db.VarChar(255)
  googleSub       String?   @map("google_sub") @db.VarChar(255)
  emailVerifiedAt DateTime? @map("email_verified_at") @db.Timestamptz
  /// 登録を始めた入口。メール確認後の着地（/mypage と /participant）を決める。
  audience        SignupAudience @default(ORGANIZER)
  expiresAt       DateTime  @map("expires_at") @db.Timestamptz
  createdAt       DateTime  @default(now()) @map("created_at") @db.Timestamptz
  @@index([email])
  @@map("signup_intents")
}

model PhoneVerificationCode {
  id             String    @id @default(uuid()) @db.Uuid
  phoneE164      String    @map("phone_e164") @db.VarChar(20)
  codeHash       String    @unique @map("code_hash") @db.VarChar(64)
  signupIntentId String?   @map("signup_intent_id") @db.Uuid
  userId         String?   @map("user_id") @db.Uuid
  expiresAt      DateTime  @map("expires_at") @db.Timestamptz
  usedAt         DateTime? @map("used_at") @db.Timestamptz
  attempts       Int       @default(0) @db.SmallInt
  createdAt      DateTime  @default(now()) @map("created_at") @db.Timestamptz
  @@index([phoneE164])
  @@map("phone_verification_codes")
}

model LoginChallenge {
  id        String   @id @default(uuid()) @db.Uuid
  userId    String   @map("user_id") @db.Uuid
  purpose   LoginChallengePurpose
  channel   LoginChallengeChannel
  codeHash  String   @unique @map("code_hash") @db.VarChar(64)
  expiresAt DateTime @map("expires_at") @db.Timestamptz
  usedAt    DateTime? @map("used_at") @db.Timestamptz
  attempts  Int      @default(0) @db.SmallInt
  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz
  user User @relation(fields: [userId], references: [id], onDelete: Cascade)
  @@index([userId])
  @@map("login_challenges")
}

// =============================================================
// 2. チケット・課金管理（マネタイズ基盤）
// =============================================================
model UserUsageQuota {
  userId               String             @id @map("user_id") @db.Uuid
  freeEventCount       Int                @default(0) @map("free_event_count") @db.SmallInt
  paidCredits          Int                @default(0) @map("paid_credits") @db.Integer
  subscriptionStatus   SubscriptionStatus @default(NONE) @map("subscription_status")
  /// 加入中の定額プラン。subscription_status が ACTIVE のときだけ意味を持つ。
  subscriptionPlan     SubscriptionPlan   @default(NONE) @map("subscription_plan")
  currentPeriodEnd     DateTime?          @map("current_period_end") @db.Timestamptz
  stripeCustomerId     String?            @unique @map("stripe_customer_id") @db.VarChar(255)
  stripeSubscriptionId String?            @unique @map("stripe_subscription_id") @db.VarChar(255)
  createdAt            DateTime           @default(now()) @map("created_at") @db.Timestamptz
  updatedAt            DateTime           @updatedAt @map("updated_at") @db.Timestamptz
  user User @relation(fields: [userId], references: [id], onDelete: Cascade)
  @@index([stripeCustomerId])
  @@index([stripeSubscriptionId])
  @@map("user_usage_quotas")
}

model BillingTransaction {
  id                      String        @id @default(uuid()) @db.Uuid
  userId                  String        @map("user_id") @db.Uuid
  paymentType             PaymentType   @map("payment_type")
  paymentStatus           PaymentStatus @default(PENDING) @map("payment_status")
  amount                  Int           @db.Integer
  currency                String        @default("jpy") @db.VarChar(3)
  stripeCheckoutSessionId String?       @unique @map("stripe_checkout_session_id") @db.VarChar(255)
  stripePaymentIntentId   String?       @unique @map("stripe_payment_intent_id") @db.VarChar(255)
  stripeInvoiceId         String?       @unique @map("stripe_invoice_id") @db.VarChar(255)
  createdAt               DateTime      @default(now()) @map("created_at") @db.Timestamptz
  updatedAt               DateTime      @updatedAt @map("updated_at") @db.Timestamptz
  user User @relation(fields: [userId], references: [id], onDelete: Cascade)
  @@index([userId])
  @@index([stripeCheckoutSessionId])
  @@map("billing_transactions")
}

model StripeWebhookEvent {
  stripeEventId String   @id @map("stripe_event_id") @db.VarChar(255)
  eventType     String   @map("event_type") @db.VarChar(255)
  processedAt   DateTime @default(now()) @map("processed_at") @db.Timestamptz
  @@map("stripe_webhook_events")
}

// =============================================================
// 3. チラシ画像アセット（チラシ生成機能との疎結合連携）
// =============================================================
model FlyerAsset {
  id              String   @id @default(uuid()) @db.Uuid
  externalFlyerId String?  @map("external_flyer_id") @db.VarChar(100)
  imageUrl        String   @map("image_url") @db.Text
  lqipDataUrl     String?  @map("lqip_data_url") @db.Text
  aspectRatio     String   @default("A4") @map("aspect_ratio") @db.VarChar(10)
  createdAt       DateTime @default(now()) @map("created_at") @db.Timestamptz
  events Event[]
  @@map("flyer_assets")
}

/// チラシ生成 1 回分の記録。回数制限と監査に使う。
/// AI の背景候補を 1 枚作るたびに 1 行足す。source = 'ai' の行だけを数える。
/// placeholder（代替背景）と upload は記録のみで、回数には数えない。
/// 保存済みイベントは event_id で数え、共同主催・幹事も同じ枠を共有する。
/// 公開前は user_id（未ログインは owner_token_hash）で event_id を NULL にし、
/// イベントを新規に作った時点で会員の行をそのイベントへ付け替える。
/// draft_key は旧仕様で、新しい行は NULL である。
/// candidate_id は保存時に flyer_asset_id を結ぶための候補の識別子である。
/// 候補画像そのものは保存しない（使い捨てのため、サービス側の TTL で消える）。
model FlyerGenerationLog {
  id             String   @id @default(uuid()) @db.Uuid
  candidateId    String?  @map("candidate_id") @db.VarChar(64)
  source         String   @default("ai") @map("source") @db.VarChar(16)
  draftKey       String?  @map("draft_key") @db.Uuid
  eventId        String?  @map("event_id") @db.Uuid
  userId         String?  @map("user_id") @db.Uuid
  ownerTokenHash String?  @map("owner_token_hash") @db.VarChar(64)
  templateId     String   @map("template_id") @db.VarChar(40)
  layoutId       String   @map("layout_id") @db.VarChar(40)
  paletteId      String   @map("palette_id") @db.VarChar(32)
  flyerAssetId   String?  @map("flyer_asset_id") @db.Uuid
  createdAt      DateTime @default(now()) @map("created_at") @db.Timestamptz
  @@index([candidateId])
  @@index([draftKey, createdAt])
  @@index([eventId, createdAt])
  @@index([ownerTokenHash, createdAt])
  @@index([userId, createdAt])
  @@map("flyer_generation_logs")
}

// =============================================================
// 3-2. 過去に入力した開催場所（住所サジェスト）
// =============================================================
/// 作成画面の「過去の会場から選ぶ」に出す会場の候補。
/// 会員は `u:<userId>`、未登録の幹事は `d:<端末トークンのsha256>` を ownerKey に持つ。
model VenueSuggestion {
  id          String   @id @default(uuid()) @db.Uuid
  ownerKey    String   @map("owner_key") @db.VarChar(80)
  fingerprint String   @db.VarChar(64)
  venueName   String?  @map("venue_name") @db.VarChar(150)
  postalCode  String?  @map("postal_code") @db.VarChar(7)
  prefecture  String?  @db.VarChar(20)
  city        String?  @db.VarChar(100)
  town        String?  @db.VarChar(100)
  addressLine String?  @map("address_line") @db.VarChar(200)
  building    String?  @db.VarChar(150)
  lastUsedAt  DateTime @default(now()) @map("last_used_at") @db.Timestamptz
  createdAt   DateTime @default(now()) @map("created_at") @db.Timestamptz
  @@unique([ownerKey, fingerprint])
  @@index([ownerKey, lastUsedAt])
  @@map("venue_suggestions")
}

// =============================================================
// 4. イベント本体
// =============================================================
model Event {
  id           String      @id @default(uuid()) @db.Uuid
  title        String      @db.VarChar(100)
  sortDate     DateTime    @map("sort_date") @db.Date
  /// 表示用に合成した開催場所。構造化住所があればそこから作り、無ければ入力された文字列をそのまま使う。
  location     String      @db.VarChar(255)
  /// 郵便番号検索で入れた住所。既存イベントは NULL のまま（location を表示に使う）。
  postalCode   String?     @map("postal_code") @db.VarChar(7)
  prefecture   String?     @db.VarChar(20)
  city         String?     @db.VarChar(100)
  town         String?     @db.VarChar(100)
  /// 丁目・番地・号。
  addressLine  String?     @map("address_line") @db.VarChar(200)
  building     String?     @db.VarChar(150)
  venueName    String?     @map("venue_name") @db.VarChar(150)
  rainPolicy   RainPolicy  @default(RAIN_OR_SHINE) @map("rain_policy")
  capacity     Int?        @db.Integer
  /// 想定する参加者の世代。NULL は未設定で、告知ページに「対象」を出さない。
  targetGeneration String? @map("target_generation") @db.VarChar(50)
  /// 告知ページのセマンティックテーマ。NULL は標準。ID の一覧は `src/lib/semantic-themes.ts`。
  themeId      String?     @map("theme_id") @db.VarChar(32)
  /// 告知ページ冒頭の概要。許可タグだけの HTML で、表示文字数（タグ・改行を除く）は 1000 字まで。NULL は未設定で、何も出さない。
  summary      String?     @map("summary") @db.Text
  flyerAssetId String?     @map("flyer_asset_id") @db.Uuid
  status       EventStatus @default(DRAFT)
  /// 将来のメディアサイト向けの掲載フラグ。いまのアプリは一覧を持たないため常に UNLISTED（紹介制）。
  /// PUBLIC はメディアサイトを別サービスとして足したときに使う。読み取り契約として列は残す。
  visibility   EventVisibility @default(UNLISTED)
  /// この日時（日本時間で入力）になると出欠の新規登録と変更を止める。空なら期限なし。
  rsvpDeadline DateTime?   @map("rsvp_deadline") @db.Timestamptz
  isDeleted    Boolean     @default(false) @map("is_deleted")
  /// 公開のときにチケットを消費した日時。下書きと複製では NULL。
  quotaChargedAt DateTime? @map("quota_charged_at") @db.Timestamptz
  /// どのチケットから公開したか。公開中の件数に数えるのは SUBSCRIPTION だけ。
  quotaSource  QuotaSource? @map("quota_source")
  /// 告知ページの勧誘カードから作ったときの参照元。直接の参照元だけを持ち、消えたら NULL に戻す。
  referrerEventId String?  @map("referrer_event_id") @db.Uuid
  createdAt    DateTime    @default(now()) @map("created_at") @db.Timestamptz
  updatedAt    DateTime    @updatedAt @map("updated_at") @db.Timestamptz
  flyerAsset     FlyerAsset?       @relation(fields: [flyerAssetId], references: [id], onDelete: SetNull)
  referrerEvent  Event?            @relation("EventReferral", fields: [referrerEventId], references: [id], onDelete: SetNull)
  referredEvents Event[]           @relation("EventReferral")
  organizers   EventOrganizer[]
  participants Participant[]
  receipts     Receipt[]
  lock         EventLock?
  invitations  EventInvitation[]
  schedules    EventSchedule[]
  pricePlans   EventPricePlan[]
  discounts    EventDiscount[]
  revenueSetting EventRevenueSetting?
  revenueShares  EventRevenueShare[]
  @@index([status, isDeleted, sortDate])
  @@index([visibility, status, isDeleted, sortDate])
  @@index([referrerEventId])
  @@map("events")
}

model EventSchedule {
  id        String   @id @default(uuid()) @db.Uuid
  eventId   String   @map("event_id") @db.Uuid
  eventDate DateTime @map("event_date") @db.Date
  /// 開始・終了から合成した表示用の値。既存行は移行前の文字列のまま残る。
  eventTime String   @map("event_time") @db.VarChar(50)
  /// 開始時刻（HH:mm）。移行前の既存行は NULL。
  startTime String?  @map("start_time") @db.VarChar(5)
  /// 終了時刻（HH:mm）。endTime < startTime は翌日への日跨ぎとして扱う。
  endTime   String?  @map("end_time") @db.VarChar(5)
  sortOrder Int      @map("sort_order")
  event     Event    @relation(fields: [eventId], references: [id], onDelete: Cascade)
  participants        Participant[]
  participantSchedules ParticipantSchedule[]
  @@index([eventId, sortOrder])
  @@map("event_schedules")
}

model EventPricePlan {
  id        String        @id @default(uuid()) @db.Uuid
  eventId   String        @map("event_id") @db.Uuid
  name      String        @db.VarChar(50)
  /// 男女別の料金にするための対象。ANY は男女共通。
  audience  PriceAudience @default(ANY)
  /// 金額（円）。0 は無料。
  amount    Int           @default(0) @db.Integer
  /// 「1ドリンク付」などの補足。表示文はサーバーで合成する。
  note      String?       @db.VarChar(100)
  /// 旧・費用文。移行の取りこぼしを防ぐため残す。新規・更新では書き込まない。
  price     String?       @db.VarChar(50)
  sortOrder Int           @map("sort_order")
  event     Event         @relation(fields: [eventId], references: [id], onDelete: Cascade)
  /// 男性用「一般」と女性用「一般」を並べられるようにする。
  @@unique([eventId, audience, name])
  @@index([eventId, sortOrder])
  @@map("event_price_plans")
}

/// 参加者が申込時に選べる割引。条件名と値引き額（円）の組を 0〜8 件持つ。
/// すべての料金プランに適用し、対象プランの指定は持たない。
model EventDiscount {
  id        String  @id @default(uuid()) @db.Uuid
  eventId   String  @map("event_id") @db.Uuid
  name      String  @db.VarChar(50)
  /// 値引き額（円）。参加者が選んだ合計をプラン金額から引く。
  amount    Int     @db.Integer
  /// 「2人以上のとき」などの補足。表示文はサーバーで合成する。
  note      String? @db.VarChar(100)
  sortOrder Int     @map("sort_order")

  event        Event                 @relation(fields: [eventId], references: [id], onDelete: Cascade)
  participants ParticipantDiscount[]

  /// 参加者が選んだ写しは、定義を消しても残る（discountId は SetNull）。
  @@index([eventId, sortOrder])
  @@map("event_discounts")
}

// =============================================================
// 5. 幹事権限テーブル（会員幹事 ＆ ゲスト幹事ハイブリッド）
// =============================================================
model EventOrganizer {
  id             String        @id @default(uuid()) @db.Uuid
  eventId        String        @map("event_id") @db.Uuid
  userId         String?       @map("user_id") @db.Uuid
  guestTokenHash String?       @unique @map("guest_token_hash") @db.VarChar(64)
  role           OrganizerRole @default(CO_HOST)
  /// ゲスト幹事の公開表示名。会員は User.name を都度参照するため NULL。
  displayName    String?       @map("display_name") @db.VarChar(50)
  createdAt      DateTime      @default(now()) @map("created_at") @db.Timestamptz
  event Event @relation(fields: [eventId], references: [id], onDelete: Cascade)
  user  User? @relation(fields: [userId], references: [id], onDelete: Cascade)
  revenueShare EventRevenueShare?
  @@unique([eventId, userId])
  @@index([userId])
  @@map("event_organizers")
}

-- 1イベント1主催者は、Prisma で表現できない部分ユニーク索引で保証する（migration の生SQL）。
-- CREATE UNIQUE INDEX "event_organizers_one_owner"
--   ON "event_organizers" ("event_id") WHERE "role" = 'OWNER';

// =============================================================
// 5-2. 共同主催の売上按分
// =============================================================
/// イベントごとの按分の設定。行が無いときは RATIO / OWN_ONLY として扱う。
model EventRevenueSetting {
  eventId         String                @id @map("event_id") @db.Uuid
  mode            RevenueSplitMode      @default(RATIO)
  visibility      RevenueShareVisibility @default(OWN_ONLY)
  updatedByUserId String?               @map("updated_by_user_id") @db.Uuid
  updatedAt       DateTime              @updatedAt @map("updated_at") @db.Timestamptz

  event Event @relation(fields: [eventId], references: [id], onDelete: Cascade)

  @@map("event_revenue_settings")
}

/// 主催者1人ぶんの配分。割合方式は shareBps、人数方式は headcount を使う。
/// 主催者が外れると Cascade で消え、残った主催者だけで再計算する。
model EventRevenueShare {
  organizerId String   @id @map("organizer_id") @db.Uuid
  eventId     String   @map("event_id") @db.Uuid
  shareBps    Int?     @map("share_bps") @db.Integer
  headcount   Int?     @map("headcount") @db.Integer
  updatedAt   DateTime @updatedAt @map("updated_at") @db.Timestamptz

  organizer EventOrganizer @relation(fields: [organizerId], references: [id], onDelete: Cascade)
  event     Event          @relation(fields: [eventId], references: [id], onDelete: Cascade)

  @@index([eventId])
  @@map("event_revenue_shares")
}

// =============================================================
// 6. 出欠・参加者レコード（未登録出欠 ＆ 会員出欠ハイブリッド）
// =============================================================
model Participant {
  id            String     @id @default(uuid()) @db.Uuid
  eventId       String     @map("event_id") @db.Uuid
  userId        String?    @map("user_id") @db.Uuid
  rsvpTokenHash String     @unique @map("rsvp_token_hash") @db.VarChar(64)
  name          String     @db.VarChar(50)
  /// 男女別の料金プランを選ぶための性別。移行前の既存行は NULL。
  gender        Gender?
  status        RsvpStatus
  comment       String?    @db.Text
  /// 代表の開催日時。複数日を選んだときは、イベントの並び順で最初の日時。
  /// 名簿・売上の「開催回別」・カレンダーはこの値を代表として見る（選択した全日は
  /// `participant_schedules` が持つ）。
  scheduleId    String?    @map("schedule_id") @db.Uuid
  /// 自分を含む参加人数。定員は人数ぶん消費し、売上も人数ぶんで数える。
  /// 出席のときだけ持ち、欠席・参加要望は 1（要望は席を取らず、承認時に入れる）。
  partySize     Int        @default(1) @map("party_size") @db.Integer
  /// 参加費を受け取った日時。NULL は未集金。金額は `priceAmount` から割引を引いた額
  /// （0 円で止める）× `partySize` で、幹事が名簿で 1 人ずつ切り替える。
  collectedAt   DateTime?  @map("collected_at") @db.Timestamptz
  /// 名簿から外した日時。NULL は有効。
  /// 幹事が名簿から削除しても行は残し、名簿の末尾に薄く出す（元に戻せる）。
  deletedAt     DateTime?  @map("deleted_at") @db.Timestamptz
  ipHash        String?    @map("ip_hash") @db.VarChar(64)
  createdAt     DateTime   @default(now()) @map("created_at") @db.Timestamptz
  updatedAt     DateTime   @updatedAt @map("updated_at") @db.Timestamptz
  event Event @relation(fields: [eventId], references: [id], onDelete: Cascade)
  user  User? @relation(fields: [userId], references: [id], onDelete: SetNull)
  /// 会員 1 人につきイベント 1 行。匿名行（userId が NULL）は重複を許す。
  @@unique([eventId, userId])
  @@index([eventId, status])
  @@index([eventId, deletedAt])
  @@index([userId, updatedAt])
  @@map("participants")
}

/// 参加者が申込時に選んだ割引。申込時点の名前・金額・補足を写す。
/// 定義（EventDiscount）を編集・削除しても、申込済みの金額は動かさない。
model ParticipantDiscount {
  id            String  @id @default(uuid()) @db.Uuid
  participantId String  @map("participant_id") @db.Uuid
  /// 選んだ定義。定義が消えると NULL になり、写しだけが残る。
  discountId    String? @map("discount_id") @db.Uuid
  name          String  @db.VarChar(50)
  amount        Int     @db.Integer
  note          String? @db.VarChar(100)
  sortOrder     Int     @map("sort_order")

  participant Participant    @relation(fields: [participantId], references: [id], onDelete: Cascade)
  discount    EventDiscount? @relation(fields: [discountId], references: [id], onDelete: SetNull)

  @@unique([participantId, discountId])
  @@index([participantId])
  @@index([discountId])
  @@map("participant_discounts")
}

/// 出席する日時。複数選べる。`participants.schedule_id` はこの先頭（代表）を持つ。
/// 欠席・参加要望のときは行を作らず、出席に戻したときに選び直す。
model ParticipantSchedule {
  participantId String @map("participant_id") @db.Uuid
  scheduleId    String @map("schedule_id") @db.Uuid

  participant Participant   @relation(fields: [participantId], references: [id], onDelete: Cascade)
  schedule    EventSchedule @relation(fields: [scheduleId], references: [id], onDelete: Cascade)

  @@id([participantId, scheduleId])
  @@index([scheduleId])
  @@map("participant_schedules")
}

// 旧・参加費の領収書。画面からは外した（新規の書き込みはしない）。
// 既存データの保護と user/hydrate の会員統合が参照するため残す。
// 集金は participants.collected_at で記録し、migration で issued_at を引き継ぐ。
model Receipt {
  id            String   @id @default(uuid()) @db.Uuid
  participantId String   @unique @map("participant_id") @db.Uuid
  eventId       String   @map("event_id") @db.Uuid
  addressee     String   @db.VarChar(100)
  amount        Int
  description   String   @db.VarChar(100)
  issuerName    String   @map("issuer_name") @db.VarChar(100)
  issuedAt      DateTime @default(now()) @map("issued_at") @db.Timestamptz
  createdAt     DateTime @default(now()) @map("created_at") @db.Timestamptz
  updatedAt     DateTime @updatedAt @map("updated_at") @db.Timestamptz
  participant Participant @relation(fields: [participantId], references: [id], onDelete: Cascade)
  event       Event       @relation(fields: [eventId], references: [id], onDelete: Cascade)
  @@index([eventId])
  @@map("receipts")
}

// =============================================================
// 7. 排他編集ロック
// =============================================================
model EventLock {
  eventId            String   @id @map("event_id") @db.Uuid
  lockedByUserId     String?  @map("locked_by_user_id") @db.Uuid
  lockedByTokenHash  String?  @map("locked_by_token_hash") @db.VarChar(64)
  lockHolderName     String   @map("lock_holder_name") @db.VarChar(50)
  lockTokenHash      String   @unique @map("lock_token_hash") @db.VarChar(64)
  updatedAt          DateTime @updatedAt @map("updated_at") @db.Timestamptz
  event Event @relation(fields: [eventId], references: [id], onDelete: Cascade)
  user  User? @relation(fields: [lockedByUserId], references: [id], onDelete: SetNull)
  @@map("event_locks")
}

// =============================================================
// 8. 共同主催・幹事の招待
// =============================================================
model EventInvitation {
  id             String   @id @default(uuid()) @db.Uuid
  eventId        String   @map("event_id") @db.Uuid
  inviteCodeHash String   @unique @map("invite_code_hash") @db.VarChar(64)
  expiresAt      DateTime @map("expires_at") @db.Timestamptz
  isRevoked      Boolean  @default(false) @map("is_revoked")
  createdAt      DateTime @default(now()) @map("created_at") @db.Timestamptz
  event Event @relation(fields: [eventId], references: [id], onDelete: Cascade)
  @@index([eventId, isRevoked, expiresAt])
  @@map("event_invitations")
}

// =============================================================
// 9. 主催者の公開プロフィール
// =============================================================

/// 行が無い会員は「未作成（非公開）」として扱う。ページ自体は誰でも開ける。
model OrganizerProfile {
  userId        String   @id @map("user_id") @db.Uuid
  isPublished   Boolean  @default(false) @map("is_published")
  headline      String?  @db.VarChar(60)
  bio           String?  @db.VarChar(400)
  area          String?  @db.VarChar(50)
  tags          String[]
  xUrl          String?  @map("x_url") @db.VarChar(200)
  instagramUrl  String?  @map("instagram_url") @db.VarChar(200)
  websiteUrl    String?  @map("website_url") @db.VarChar(200)
  lineUrl       String?  @map("line_url") @db.VarChar(200)
  showStats     Boolean  @default(false) @map("show_stats")
  /// 公開ページのアイコン。未設定は名前の頭文字。
  avatarImageId String?  @unique @map("avatar_image_id") @db.Uuid
  /// 公開ページの先頭に敷く横長の画像（3:1）。未設定は何も出さない。
  headerImageId String?  @unique @map("header_image_id") @db.Uuid
  /// 公開ページのテーマ。NULL は標準の見た目。
  themeId       String?  @map("theme_id") @db.VarChar(32)
  createdAt     DateTime @default(now()) @map("created_at") @db.Timestamptz
  updatedAt     DateTime @updatedAt @map("updated_at") @db.Timestamptz

  user        User        @relation(fields: [userId], references: [id], onDelete: Cascade)
  avatarImage ImageAsset? @relation("OrganizerProfileAvatar", fields: [avatarImageId], references: [id], onDelete: SetNull)
  headerImage ImageAsset? @relation("OrganizerProfileHeader", fields: [headerImageId], references: [id], onDelete: SetNull)

  @@map("organizer_profiles")
}

// =============================================================
// 10. 会員が上げた画像（アイコンなど）
// =============================================================

/// 1 行 1 画像。参照する側（organizer_profiles.avatar_image_id など）に外部キーを置く。
/// 用途は列挙型にせず kind（VARCHAR）で持つ。用途が増えてもマイグレーションが要らない。
model ImageAsset {
  id          String   @id @default(uuid()) @db.Uuid
  userId      String?  @map("user_id") @db.Uuid
  kind        String   @db.VarChar(20)
  contentType String   @map("content_type") @db.VarChar(40)
  width       Int
  height      Int
  byteSize    Int      @map("byte_size")
  isDeleted   Boolean  @default(false) @map("is_deleted")
  createdAt   DateTime @default(now()) @map("created_at") @db.Timestamptz

  user                   User?             @relation(fields: [userId], references: [id], onDelete: SetNull)
  organizerProfile       OrganizerProfile? @relation("OrganizerProfileAvatar")
  organizerProfileHeader OrganizerProfile? @relation("OrganizerProfileHeader")

// =============================================================
// 11. 主催者へのアプリ内通知
// =============================================================

/// 参加者の出席・参加要望を主催者へ知らせる 1 行。メールは送らない。
/// 文面は作成時点で確定して持つ（催し名を後から変えても過去の通知は変わらない）。
model Notification {
  id            String           @id @default(uuid()) @db.Uuid
  /// 受け取る会員。ゲスト主催者（userId を持たない行）には作らない。
  userId        String           @map("user_id") @db.Uuid
  eventId       String           @map("event_id") @db.Uuid
  /// 通知の元になった出欠行。取り消されても通知は残すため SetNull。
  participantId String?          @map("participant_id") @db.Uuid
  kind          NotificationKind
  title         String           @db.VarChar(100)
  body          String           @db.VarChar(300)
  /// 同じ出欠行の同じ変化を二重に作らない指紋（sha256 の hex）。再送と競合を吸収する。
  dedupeKey     String           @unique @map("dedupe_key") @db.VarChar(64)
  /// 読んだ日時。NULL は未読。未読数はこの列で数える。
  readAt        DateTime?        @map("read_at") @db.Timestamptz
  createdAt     DateTime         @default(now()) @map("created_at") @db.Timestamptz

  user        User         @relation(fields: [userId], references: [id], onDelete: Cascade)
  event       Event        @relation(fields: [eventId], references: [id], onDelete: Cascade)
  participant Participant? @relation(fields: [participantId], references: [id], onDelete: SetNull)

  @@index([userId, readAt, createdAt])
  @@index([userId, createdAt])
  @@map("notifications")
}
```

---

### 4.2. PostgreSQL 16+ DDL 定義

```sql
-- 列挙型の作成
CREATE TYPE subscription_status_enum AS ENUM ('NONE', 'ACTIVE', 'PAST_DUE', 'CANCELED', 'INCOMPLETE');

CREATE TYPE subscription_plan_enum AS ENUM ('NONE', 'MONTHLY_8', 'UNLIMITED');
CREATE TYPE quota_source_enum AS ENUM ('FREE_TRIAL', 'PAID_CREDIT', 'SUBSCRIPTION');

CREATE TYPE payment_type_enum AS ENUM ('ONE_TIME', 'SUBSCRIPTION');

CREATE TYPE payment_status_enum AS ENUM ('PENDING', 'SUCCEEDED', 'FAILED', 'REFUNDED', 'DISPUTED');

CREATE TYPE rain_policy_enum AS ENUM ('RAIN_OR_SHINE', 'CANCEL_ON_RAIN', 'POSTPONE_ON_RAIN', 'INDOOR');

CREATE TYPE event_status_enum AS ENUM ('DRAFT', 'PUBLISHED', 'CLOSED');

CREATE TYPE event_visibility_enum AS ENUM ('PUBLIC', 'UNLISTED');

CREATE TYPE organizer_role_enum AS ENUM ('OWNER', 'CO_HOST');

CREATE TYPE rsvp_status_enum AS ENUM ('ATTENDING', 'DECLINED');

-- 料金プランの対象（ANY は男女共通）と参加者の性別。
CREATE TYPE price_audience_enum AS ENUM ('ANY', 'MALE', 'FEMALE');

CREATE TYPE gender_enum AS ENUM ('MALE', 'FEMALE');

CREATE TYPE platform_role_enum AS ENUM ('MEMBER', 'ADMIN');

CREATE TYPE login_challenge_channel_enum AS ENUM ('SMS', 'EMAIL');

CREATE TYPE login_challenge_purpose_enum AS ENUM ('MEMBER', 'ADMIN', 'PARTICIPANT');

CREATE TYPE signup_audience_enum AS ENUM ('ORGANIZER', 'PARTICIPANT');

-- 1. 会員テーブル
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(255) UNIQUE NOT NULL,
    name VARCHAR(50) NOT NULL,
    password_hash VARCHAR(255) NULL,
    google_sub VARCHAR(255) UNIQUE NULL,
    platform_role platform_role_enum NOT NULL DEFAULT 'MEMBER',
    email_verified_at TIMESTAMPTZ NULL,
    phone_e164 VARCHAR(20) UNIQUE NULL,
    phone_verified_at TIMESTAMPTZ NULL,
    deleted_at TIMESTAMPTZ NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_users_deleted_at ON users(deleted_at) WHERE deleted_at IS NOT NULL;

COMMENT ON COLUMN users.deleted_at IS '退会（論理削除）の日時。NULL は在籍。電話番号は退会後も残し、再登録の突き合わせに使う。';

-- 会員が自分の情報を変えた記録。値はマスク済みだけを残し、パスワードは入れない。
CREATE TYPE account_change_kind_enum AS ENUM ('NAME', 'EMAIL', 'PHONE', 'PASSWORD', 'WITHDRAW', 'REACTIVATE');

CREATE TABLE account_change_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NULL REFERENCES users(id) ON DELETE SET NULL,
    kind account_change_kind_enum NOT NULL,
    before_value VARCHAR(255) NULL,
    after_value VARCHAR(255) NULL,
    ip_hash VARCHAR(64) NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_account_change_logs_user_created ON account_change_logs(user_id, created_at);

-- メールアドレス変更の保留中。新しいアドレスに届いたリンクを開くと確定する。
CREATE TABLE email_change_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    new_email VARCHAR(255) NOT NULL,
    token_hash VARCHAR(64) UNIQUE NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    used_at TIMESTAMPTZ NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_email_change_requests_user ON email_change_requests(user_id);

CREATE TABLE signup_intents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(255) NOT NULL,
    name VARCHAR(50) NOT NULL,
    password_hash VARCHAR(255) NULL,
    google_sub VARCHAR(255) NULL,
    email_verified_at TIMESTAMPTZ NULL,
    audience signup_audience_enum NOT NULL DEFAULT 'ORGANIZER',
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_signup_intents_email ON signup_intents(email);

CREATE TABLE phone_verification_codes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    phone_e164 VARCHAR(20) NOT NULL,
    code_hash VARCHAR(64) UNIQUE NOT NULL,
    signup_intent_id UUID NULL REFERENCES signup_intents(id) ON DELETE CASCADE,
    user_id UUID NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at TIMESTAMPTZ NOT NULL,
    used_at TIMESTAMPTZ NULL,
    attempts SMALLINT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT phone_verification_codes_subject_check CHECK (user_id IS NOT NULL OR signup_intent_id IS NOT NULL)
);

CREATE TABLE login_challenges (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    purpose VARCHAR(16) NOT NULL,
    channel VARCHAR(16) NOT NULL,
    code_hash VARCHAR(64) UNIQUE NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    used_at TIMESTAMPTZ NULL,
    attempts SMALLINT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_login_challenges_user_id ON login_challenges(user_id);

-- 確認番号の失敗回数は bucket = 'login-2fa:fail:user:<user_id>'、
-- ロックの開始時刻は bucket = 'login-2fa:lock:user:<user_id>' として auth_attempts に置く。
-- 失敗が 10 回に達したらロック開始行を作り、15 分後に自動で解除する。

-- 2. チケット情報テーブル
CREATE TABLE user_usage_quotas (
    user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    free_event_count SMALLINT NOT NULL DEFAULT 0 CHECK (free_event_count >= 0),
    paid_credits INT NOT NULL DEFAULT 0 CHECK (paid_credits >= 0),
    subscription_status subscription_status_enum NOT NULL DEFAULT 'NONE',
    subscription_plan subscription_plan_enum NOT NULL DEFAULT 'NONE',
    current_period_end TIMESTAMPTZ NULL,
    stripe_customer_id VARCHAR(255) UNIQUE NULL,
    stripe_subscription_id VARCHAR(255) UNIQUE NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_quotas_customer ON user_usage_quotas(stripe_customer_id);

CREATE INDEX idx_quotas_subscription ON user_usage_quotas(stripe_subscription_id);

-- 3. 課金決済履歴テーブル
CREATE TABLE billing_transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    payment_type payment_type_enum NOT NULL,
    payment_status payment_status_enum NOT NULL DEFAULT 'PENDING',
    amount INT NOT NULL CHECK (amount >= 0),
    currency VARCHAR(3) NOT NULL DEFAULT 'jpy',
    stripe_checkout_session_id VARCHAR(255) UNIQUE NULL,
    stripe_payment_intent_id VARCHAR(255) UNIQUE NULL,
    stripe_invoice_id VARCHAR(255) UNIQUE NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_billing_tx_user ON billing_transactions(user_id);

CREATE INDEX idx_billing_tx_session ON billing_transactions(stripe_checkout_session_id);

-- 4. Webhook冪等性管理テーブル
CREATE TABLE stripe_webhook_events (
    stripe_event_id VARCHAR(255) PRIMARY KEY,
    event_type VARCHAR(255) NOT NULL,
    processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 5. チラシ画像アセットテーブル
CREATE TABLE flyer_assets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    external_flyer_id VARCHAR(100) NULL,
    image_url TEXT NOT NULL,
    lqip_data_url TEXT NULL,
    aspect_ratio VARCHAR(10) NOT NULL DEFAULT 'A4',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 5-2. チラシ生成履歴（AI 背景の回数制限）
-- AI の背景候補を 1 枚作るたびに 1 行足す。source = 'ai' の行だけを数える。
-- placeholder（代替背景）と upload は記録のみで、回数には数えない。
-- 会員の event_id が NULL の行は未確定で、イベントを新規に作った時点で付け替える。
-- 端末（未ログイン）の行は付け替えない。
-- draft_key は旧仕様で、新しい行は NULL。
CREATE TABLE flyer_generation_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    candidate_id VARCHAR(64) NULL,
    source VARCHAR(16) NOT NULL DEFAULT 'ai',
    draft_key UUID NULL,
    event_id UUID NULL, -- events(id) を参照（ON DELETE SET NULL）
    user_id UUID NULL,
    owner_token_hash VARCHAR(64) NULL,
    template_id VARCHAR(40) NOT NULL,
    layout_id VARCHAR(40) NOT NULL,
    palette_id VARCHAR(32) NOT NULL,
    flyer_asset_id UUID NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX flyer_generation_logs_candidate_id_idx
    ON flyer_generation_logs (candidate_id);
CREATE INDEX flyer_generation_logs_draft_key_created_at_idx
    ON flyer_generation_logs (draft_key, created_at);
CREATE INDEX flyer_generation_logs_event_id_created_at_idx
    ON flyer_generation_logs (event_id, created_at);
CREATE INDEX flyer_generation_logs_owner_token_hash_created_at_idx
    ON flyer_generation_logs (owner_token_hash, created_at);
CREATE INDEX flyer_generation_logs_user_id_created_at_idx
    ON flyer_generation_logs (user_id, created_at);

-- 5-3. 過去に入力した会場の候補（住所サジェスト）
-- 会員は u:<user_id>、未登録の幹事は d:<Cookie venue_owner の sha256> を owner_key に持つ。
-- 同じ会場は (owner_key, fingerprint) で 1 行にまとめ、last_used_at だけを更新する。
CREATE TABLE venue_suggestions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_key VARCHAR(80) NOT NULL,
    fingerprint VARCHAR(64) NOT NULL,
    venue_name VARCHAR(150) NULL,
    postal_code VARCHAR(7) NULL,
    prefecture VARCHAR(20) NULL,
    city VARCHAR(100) NULL,
    town VARCHAR(100) NULL,
    address_line VARCHAR(200) NULL,
    building VARCHAR(150) NULL,
    last_used_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX venue_suggestions_owner_key_fingerprint_key
    ON venue_suggestions (owner_key, fingerprint);
CREATE INDEX venue_suggestions_owner_key_last_used_at_idx
    ON venue_suggestions (owner_key, last_used_at);

-- 6. イベント本体テーブル
CREATE TABLE events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title VARCHAR(100) NOT NULL,
    sort_date DATE NOT NULL,
    location VARCHAR(255) NOT NULL,
    postal_code VARCHAR(7) NULL,
    prefecture VARCHAR(20) NULL,
    city VARCHAR(100) NULL,
    town VARCHAR(100) NULL,
    address_line VARCHAR(200) NULL,
    building VARCHAR(150) NULL,
    venue_name VARCHAR(150) NULL,
    rain_policy rain_policy_enum NOT NULL DEFAULT 'RAIN_OR_SHINE',
    capacity INT NULL CHECK (capacity > 0),
    target_generation VARCHAR(50) NULL,
    theme_id VARCHAR(32) NULL,
    summary TEXT NULL, -- 任意。許可タグだけの HTML。表示文字数（タグ・改行を除く）は 1000 字まで
    flyer_asset_id UUID NULL REFERENCES flyer_assets(id) ON DELETE SET NULL,
    status event_status_enum NOT NULL DEFAULT 'DRAFT',
    visibility event_visibility_enum NOT NULL DEFAULT 'UNLISTED',
    rsvp_deadline TIMESTAMPTZ NULL,
    is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
    referrer_event_id UUID NULL REFERENCES events(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_events_search ON events(status, is_deleted, sort_date);
CREATE INDEX idx_events_visibility_search ON events(visibility, status, is_deleted, sort_date);
CREATE INDEX idx_events_referrer ON events(referrer_event_id);

-- 6b. 開催日時（1〜8件）
CREATE TABLE event_schedules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    event_date DATE NOT NULL,
    event_time VARCHAR(50) NOT NULL,
    start_time VARCHAR(5) NULL,
    end_time VARCHAR(5) NULL,
    sort_order INT NOT NULL
);

CREATE INDEX idx_event_schedules_event ON event_schedules(event_id, sort_order);
CREATE INDEX idx_event_schedules_date ON event_schedules(event_date);

-- 6c. 料金プラン（プラン名 + 対象 + 金額。1〜8件）
CREATE TABLE event_price_plans (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    name VARCHAR(50) NOT NULL,
    audience price_audience_enum NOT NULL DEFAULT 'ANY',
    amount INT NOT NULL DEFAULT 0 CHECK (amount >= 0),
    note VARCHAR(100) NULL,
    price VARCHAR(50) NULL,
    sort_order INT NOT NULL,
    CONSTRAINT uq_event_audience_name UNIQUE (event_id, audience, name)
);

CREATE INDEX idx_event_price_plans_event ON event_price_plans(event_id, sort_order);

-- 6d. 割引（条件名 + 値引き額。0〜8件。すべてのプランに適用）
CREATE TABLE event_discounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    name VARCHAR(50) NOT NULL,
    amount INT NOT NULL CHECK (amount > 0),
    note VARCHAR(100) NULL,
    sort_order INT NOT NULL
);

CREATE INDEX idx_event_discounts_event ON event_discounts(event_id, sort_order);

-- 7. 幹事権限テーブル
CREATE TABLE event_organizers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    user_id UUID NULL REFERENCES users(id) ON DELETE CASCADE,
    guest_token_hash VARCHAR(64) UNIQUE NULL,
    role organizer_role_enum NOT NULL DEFAULT 'CO_HOST',
    display_name VARCHAR(50) NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_event_user UNIQUE (event_id, user_id)
);

CREATE INDEX idx_organizers_user ON event_organizers(user_id);

-- 1イベント1主催者を保証する部分ユニーク索引。
CREATE UNIQUE INDEX event_organizers_one_owner
    ON event_organizers(event_id)
    WHERE role = 'OWNER';

-- 8. 共同主催の売上按分
CREATE TABLE event_revenue_settings (
    event_id UUID PRIMARY KEY REFERENCES events(id) ON DELETE CASCADE,
    mode revenue_split_mode_enum NOT NULL DEFAULT 'RATIO',
    visibility revenue_share_visibility_enum NOT NULL DEFAULT 'OWN_ONLY',
    updated_by_user_id UUID NULL,
    updated_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE event_revenue_shares (
    organizer_id UUID PRIMARY KEY REFERENCES event_organizers(id) ON DELETE CASCADE,
    event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    share_bps INTEGER NULL,
    headcount INTEGER NULL,
    updated_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX idx_revenue_shares_event ON event_revenue_shares(event_id);

-- 9. 参加者・出欠テーブル
CREATE TABLE participants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    user_id UUID NULL REFERENCES users(id) ON DELETE SET NULL,
    rsvp_token_hash VARCHAR(64) UNIQUE NOT NULL,
    name VARCHAR(50) NOT NULL,
    gender gender_enum NULL,
    status rsvp_status_enum NOT NULL,
    comment TEXT NULL,
    schedule_id UUID NULL REFERENCES event_schedules(id) ON DELETE SET NULL,
    -- 自分を含む参加人数。定員は人数ぶん消費し、売上も人数ぶんで数える。
    -- 出席のときだけ持ち、欠席・参加要望は 1（要望は席を取らず、承認時に入れる）。
    party_size INTEGER NOT NULL DEFAULT 1 CHECK (party_size >= 1),
    price_plan_id UUID NULL REFERENCES event_price_plans(id) ON DELETE SET NULL,
    -- 出欠確定時点の料金プランの写し。プラン編集後も見込み売上を変えない。
    price_amount INTEGER NULL,
    price_plan_name VARCHAR(50) NULL,
    price_audience price_audience_enum NULL,
    -- 参加費を受け取った日時。NULL は未集金。金額は price_amount から割引を引いた額
    -- （0 円で止める）× party_size で、幹事が名簿で 1 人ずつ切り替える。
    collected_at TIMESTAMPTZ NULL,
    -- 名簿から外した日時。NULL は有効。幹事が名簿から削除しても行は残し、
    -- 名簿の末尾に薄く出す（元に戻せる）。
    deleted_at TIMESTAMPTZ NULL,
    ip_hash VARCHAR(64) NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_participants_event_status ON participants(event_id, status);

-- 名簿は未削除の行だけを催しごとに引くため。
CREATE INDEX participants_event_id_deleted_at_idx ON participants(event_id, deleted_at);

-- 会員 1 人につきイベント 1 行。匿名行（user_id が NULL）は PostgreSQL の一意制約では重複を許す。
CREATE UNIQUE INDEX participants_event_id_user_id_key ON participants(event_id, user_id);

CREATE INDEX participants_user_id_updated_at_idx ON participants(user_id, updated_at);

-- 9b. 参加者が選んだ割引（申込時点の写し。定義が消えると discount_id は NULL）
CREATE TABLE participant_discounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    participant_id UUID NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
    discount_id UUID NULL REFERENCES event_discounts(id) ON DELETE SET NULL,
    name VARCHAR(50) NOT NULL,
    amount INT NOT NULL CHECK (amount > 0),
    note VARCHAR(100) NULL,
    sort_order INT NOT NULL,
    CONSTRAINT uq_participant_discount UNIQUE (participant_id, discount_id)
);

CREATE INDEX idx_participant_discounts_participant ON participant_discounts(participant_id);
CREATE INDEX idx_participant_discounts_discount ON participant_discounts(discount_id);

-- 9c. 出席する日時（複数可）。participants.schedule_id はこの先頭（代表）を持つ。
CREATE TABLE participant_schedules (
    participant_id UUID NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
    schedule_id UUID NOT NULL REFERENCES event_schedules(id) ON DELETE CASCADE,
    PRIMARY KEY (participant_id, schedule_id)
);

CREATE INDEX idx_participant_schedules_schedule ON participant_schedules(schedule_id);

-- 8b. 旧・参加費の領収書（画面からは外した。既存データの保護のため残し、新規の書き込みはしない）
CREATE TABLE receipts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    participant_id UUID NOT NULL UNIQUE REFERENCES participants(id) ON DELETE CASCADE,
    event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    addressee VARCHAR(100) NOT NULL,
    amount INTEGER NOT NULL CHECK (amount > 0),
    description VARCHAR(100) NOT NULL,
    issuer_name VARCHAR(100) NOT NULL,
    issued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_receipts_event ON receipts(event_id);

-- 9. 排他編集ロックテーブル
CREATE TABLE event_locks (
    event_id UUID PRIMARY KEY REFERENCES events(id) ON DELETE CASCADE,
    locked_by_user_id UUID NULL REFERENCES users(id) ON DELETE SET NULL,
    locked_by_token_hash VARCHAR(64) NULL,
    lock_holder_name VARCHAR(50) NOT NULL,
    lock_token_hash VARCHAR(64) UNIQUE NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 10. 共同主催・幹事の招待テーブル
CREATE TABLE event_invitations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    invite_code_hash VARCHAR(64) UNIQUE NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    is_revoked BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_invitations_valid ON event_invitations(event_id, is_revoked, expires_at);

-- 11. 主催者の公開プロフィール（行が無い会員は未作成・非公開）
CREATE TABLE organizer_profiles (
    user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    is_published BOOLEAN NOT NULL DEFAULT FALSE,
    headline VARCHAR(60) NULL,
    bio VARCHAR(400) NULL,
    area VARCHAR(50) NULL,
    tags TEXT[] NOT NULL DEFAULT '{}',
    x_url VARCHAR(200) NULL,
    instagram_url VARCHAR(200) NULL,
    website_url VARCHAR(200) NULL,
    line_url VARCHAR(200) NULL,
    show_stats BOOLEAN NOT NULL DEFAULT FALSE,
    avatar_image_id UUID NULL UNIQUE REFERENCES image_assets(id) ON DELETE SET NULL,
    header_image_id UUID NULL UNIQUE REFERENCES image_assets(id) ON DELETE SET NULL,
    theme_id VARCHAR(32) NULL, -- 未知の値はアプリ側で NULL（標準）に落とす
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 12. 会員が上げた画像（アイコンなど）
-- 参照する側に外部キーを置くので、用途（kind）が増えてもこの表は変えない。
CREATE TABLE image_assets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NULL REFERENCES users(id) ON DELETE SET NULL,
    kind VARCHAR(20) NOT NULL, -- AVATAR / EVENT_COVER / PROFILE_HEADER
    content_type VARCHAR(40) NOT NULL, -- いまは image/webp のみ
    width INT NOT NULL,
    height INT NOT NULL,
    byte_size INT NOT NULL,
    is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX image_assets_user_id_is_deleted_idx ON image_assets (user_id, is_deleted);

-- 13. 主催者へのアプリ内通知（参加表明・参加要望）
-- 文面は作成時点で焼き付ける。メールの宛先や配信結果は持たない。
CREATE TYPE "NotificationKind" AS ENUM ('RSVP_ATTENDING', 'RSVP_WAITLISTED');

CREATE TABLE notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    participant_id UUID NULL REFERENCES participants(id) ON DELETE SET NULL,
    kind "NotificationKind" NOT NULL,
    title VARCHAR(100) NOT NULL,
    body VARCHAR(300) NOT NULL,
    dedupe_key VARCHAR(64) NOT NULL UNIQUE,
    read_at TIMESTAMPTZ NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX notifications_user_id_read_at_created_at_idx
    ON notifications (user_id, read_at, created_at);
CREATE INDEX notifications_user_id_created_at_idx
    ON notifications (user_id, created_at);
```

> `image_assets` は `organizer_profiles` より先に作る必要がある（外部キーの向き）。
> 実際のマイグレーション（`20261028120000_organizer_profile_theme_and_avatar`）もこの順で流す。
> バイト列は `storage/images/{id}.webp` に置き、DB には所在と大きさだけを持つ。
>
> `header_image_id` は後から足した列である。`prisma/migrations/20261101150000_organizer_profile_header_image/migration.sql` が
> `ALTER TABLE` で列と UNIQUE 索引を足し、`image_assets(id)` への外部キーを `ON DELETE SET NULL` で張る。
> 既存行は NULL のままで、ヘッダーを設定していない主催者の見た目は変わらない。

---

### 4.3. 価格キャンペーン関連（追加マイグレーション）

`prisma/migrations/20261021150000_pricing_campaigns/migration.sql` で追加する。要件は [価格キャンペーン要件定義書](pricing_campaign_requirements.md) を正とする。

#### 追加カラム

```sql
-- 割引前の定価と適用キャンペーンを会計記録に残す
ALTER TABLE billing_transactions
  ADD COLUMN list_amount INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN discount_amount INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN campaign_id UUID,
  ADD COLUMN applied_percent SMALLINT,
  ADD COLUMN stripe_coupon_id VARCHAR(255),
  ADD COLUMN request_key VARCHAR(255) UNIQUE;

UPDATE billing_transactions SET list_amount = amount WHERE amount > 0;

-- 0円月額の終了前通知の基準日時
ALTER TABLE user_usage_quotas
  ADD COLUMN pricing_campaign_id UUID,
  ADD COLUMN discount_ends_at TIMESTAMPTZ,
  ADD COLUMN discount_percent SMALLINT;

-- 外部キーは pricing_campaigns の作成後に張る（migration.sql の順序に従う）
ALTER TABLE billing_transactions
  ADD CONSTRAINT billing_transactions_campaign_id_fkey
  FOREIGN KEY (campaign_id) REFERENCES pricing_campaigns(id) ON DELETE SET NULL;

ALTER TABLE user_usage_quotas
  ADD CONSTRAINT user_usage_quotas_pricing_campaign_id_fkey
  FOREIGN KEY (pricing_campaign_id) REFERENCES pricing_campaigns(id) ON DELETE SET NULL;

CREATE INDEX user_usage_quotas_discount_ends_at_idx ON user_usage_quotas(discount_ends_at);
CREATE INDEX billing_transactions_campaign_id_user_id_payment_type_payment_status_idx
  ON billing_transactions(campaign_id, user_id, payment_type, payment_status);
```

#### Prisma モデル（抜粋）

```text
model PricingCampaign {
  id               String         @id @default(uuid()) @db.Uuid
  name             String         @db.VarChar(100)
  target           PricingTarget
  discountKind     DiscountKind   @map("discount_kind")
  percent          Int            @db.SmallInt
  startsAt         DateTime       @map("starts_at") @db.Timestamptz
  endsAt           DateTime       @map("ends_at") @db.Timestamptz
  priority         Int            @default(0) @db.SmallInt
  isEnabled        Boolean        @default(true) @map("is_enabled")
  freePerUserLimit Int            @default(1) @map("free_per_user_limit") @db.SmallInt
  version          Int            @default(1)
  createdByUserId  String?        @map("created_by_user_id") @db.Uuid
  stoppedAt        DateTime?      @map("stopped_at") @db.Timestamptz
  createdAt        DateTime       @default(now()) @map("created_at") @db.Timestamptz
  updatedAt        DateTime       @updatedAt @map("updated_at") @db.Timestamptz
  coupons          PricingCampaignCoupon[]
  audits           PricingCampaignAudit[]
  transactions     BillingTransaction[]
  quotas           UserUsageQuota[]        @relation("QuotaPricingCampaign")
  notices          BillingNotice[]
  @@index([target, isEnabled, startsAt, endsAt, priority])
  @@map("pricing_campaigns")
}

model PricingCampaignCoupon {
  id             String       @id @default(uuid()) @db.Uuid
  campaignId     String       @map("campaign_id") @db.Uuid
  version        Int
  months         Int          @db.SmallInt
  kind           DiscountKind
  /// 対象プラン。BOTH キャンペーンは対象プランごとに 1 行ずつ作るため、行ごとに具体値が入る。
  plan           PricingTarget
  stripeCouponId String       @unique @map("stripe_coupon_id") @db.VarChar(255)
  createdAt      DateTime     @default(now()) @map("created_at") @db.Timestamptz
  @@unique([campaignId, version, months, kind, plan])
  @@map("pricing_campaign_coupons")
}

model PricingCampaignAudit {
  id          String   @id @default(uuid()) @db.Uuid
  campaignId  String   @map("campaign_id") @db.Uuid
  actorUserId String?  @map("actor_user_id") @db.Uuid
  action      String   @db.VarChar(20)
  before      Json?
  after       Json?
  createdAt   DateTime @default(now()) @map("created_at") @db.Timestamptz
  @@index([campaignId, createdAt])
  @@map("pricing_campaign_audits")
}

model BillingNotice {
  id             String            @id @default(uuid()) @db.Uuid
  userId         String            @map("user_id") @db.Uuid
  campaignId     String?           @map("campaign_id") @db.Uuid
  kind           BillingNoticeKind
  periodEnd      DateTime          @map("period_end") @db.Timestamptz
  recipientEmail String            @map("recipient_email") @db.VarChar(255)
  subject        String            @db.VarChar(200)
  body           String            @db.Text
  status         String            @db.VarChar(20)
  createdAt      DateTime          @default(now()) @map("created_at") @db.Timestamptz
  @@unique([userId, kind, periodEnd])
  @@index([createdAt])
  @@map("billing_notices")
}
```

`BillingNotice` の `@@unique([userId, kind, periodEnd])` が、同じ無料期間に 3 日前・1 日前の案内を 1 回ずつしか送らないための冪等キーになる。

---

### 4.4. 初月無料（追加マイグレーション）

`prisma/migrations/20261102180000_first_month_free_trial/migration.sql` で追加する。仕様は [価格キャンペーン要件定義書 §4.4](pricing_campaign_requirements.md) と [バックエンド API §6.3](backend_api_implementation_spec.md) を正とする。

#### 追加カラム

```sql
-- 初月無料の終了日時と、使った印。既存行は NULL のままで請求は変わらない。
ALTER TABLE user_usage_quotas
  ADD COLUMN trial_ends_at TIMESTAMPTZ,
  ADD COLUMN trial_used_at TIMESTAMPTZ;

-- 3日前・1日前の案内が、無料期間の終わりを毎日1回だけ引くための索引
CREATE INDEX user_usage_quotas_trial_ends_at_idx ON user_usage_quotas(trial_ends_at);

-- 0円の初回請求を、クーポンによる割引と区別する
ALTER TABLE billing_transactions
  ADD COLUMN trial_applied BOOLEAN NOT NULL DEFAULT false;
```

#### 列の意味

| テーブル | 列 | 型 | 意味 |
| :---- | :---- | :---- | :---- |
| `user_usage_quotas` | `trial_ends_at` | TIMESTAMPTZ NULL | 初月無料の終了日時。Stripe が `trialing` のあいだだけ値を持つ |
| `user_usage_quotas` | `trial_used_at` | TIMESTAMPTZ NULL | 初月無料を使った日時。無料期間が終わっても消さず、再加入の判定に使う |
| `billing_transactions` | `trial_applied` | BOOLEAN NOT NULL DEFAULT false | 初月無料の 0 円請求か。クーポン割引の 0 円と区別する |

- `trial_ends_at` は `trialing` から `active` へ移った時点で NULL に戻す（`syncSubscription` / `recordSubscriptionInvoice`）。`trial_used_at` は残す。
- 再加入の可否は `trial_used_at IS NULL` かつ有効な定額契約がないことで判定し、`trial_ends_at` では判定しない。

---

### 4.5. 無料チケットと紹介（追加マイグレーション）

`prisma/migrations/20261102190000_free_tickets/migration.sql` と `prisma/migrations/20261103090000_referral_notifications/migration.sql` で追加する。仕様は [無料チケット（紹介・動画視聴）の実装計画](issues/free-ticket-and-referral.md) と [バックエンド API §8.17](backend_api_implementation_spec.md)、[§5.18](backend_api_implementation_spec.md) を正とする。

#### 追加テーブル（`free_tickets`）

```sql
CREATE TYPE "FreeTicketSource" AS ENUM ('AD', 'REFERRAL', 'MANUAL');

CREATE TABLE "free_tickets" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "source" "FreeTicketSource" NOT NULL,
    "granted_by_user_id" UUID,
    "reason_key" VARCHAR(255),
    "provider" VARCHAR(50),
    "issued_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "used_at" TIMESTAMPTZ,
    "event_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "free_tickets_pkey" PRIMARY KEY ("id")
);

-- 二重付与を止める。同じ理由（例: referral:<新規userId>:0）で2枚目を作らせない。
CREATE UNIQUE INDEX "free_tickets_reason_key_key" ON "free_tickets"("reason_key");

-- 残数の数え上げと、期限が近い券の選択。
CREATE INDEX "free_tickets_user_id_used_at_expires_at_idx" ON "free_tickets"("user_id", "used_at", "expires_at");

-- 紹介の生涯上限（紹介者ごと・種別ごとの件数）。
CREATE INDEX "free_tickets_granted_by_user_id_source_idx" ON "free_tickets"("granted_by_user_id", "source");

-- 期限切れの掃除と、配布の監視。
CREATE INDEX "free_tickets_expires_at_idx" ON "free_tickets"("expires_at");

ALTER TABLE "free_tickets"
    ADD CONSTRAINT "free_tickets_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "free_tickets"
    ADD CONSTRAINT "free_tickets_granted_by_user_id_fkey"
    FOREIGN KEY ("granted_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
```

残数を列に持たず、**1枚1行**で持つ。使うときは `used_at` を立て、残数は「`used_at IS NULL` かつ `expires_at` が未来」の行を数える。`user_usage_quotas.paid_credits` と混ぜない。あの列は期限を持てないため、7日の券と3か月の券を同じ残高に入れると、どちらが先に消えるかを表せない。

#### 追加カラム

```sql
-- 紹介のコードと、誰の紹介で登録したか。既存行は NULL のままで、
-- コードは初めて紹介画面を開いたときに作る（バックフィルしない）。
ALTER TABLE "users"
  ADD COLUMN "referral_code" VARCHAR(12),
  ADD COLUMN "referred_by_user_id" UUID;

CREATE UNIQUE INDEX "users_referral_code_key" ON "users"("referral_code");

-- 登録意向にもコードを持たせる。`beginSignupIntent` は毎回作り直すので、
-- 呼び出し側が登録のたびに渡し直す。
ALTER TABLE "signup_intents"
  ADD COLUMN "referral_code" VARCHAR(12);

-- 紹介でチケットが配られたことを知らせる通知の種別。
ALTER TYPE "NotificationKind" ADD VALUE 'REFERRAL_GRANTED';

-- 紹介の通知は催しを持たない。外部キーはそのままで、NULL を許すだけ。
ALTER TABLE "notifications" ALTER COLUMN "event_id" DROP NOT NULL;
```

#### 列の意味

| テーブル | 列 | 型 | 意味 |
| :---- | :---- | :---- | :---- |
| `free_tickets` | `id` | UUID PK | 券1枚の識別子 |
| `free_tickets` | `user_id` | UUID NOT NULL（`users` へ ON DELETE CASCADE） | 券を持つ会員 |
| `free_tickets` | `source` | `FreeTicketSource` NOT NULL | 発行元。`REFERRAL` は紹介、`AD` は動画（未実装）、`MANUAL` は運営の付与 |
| `free_tickets` | `granted_by_user_id` | UUID NULL（`users` へ ON DELETE SET NULL） | 紹介で券を配った相手（紹介されて登録した会員）。生涯上限の数え上げと自己紹介の検出に使う |
| `free_tickets` | `reason_key` | VARCHAR(255) NULL UNIQUE | 二重付与を止めるキー。紹介は `referral:<新規userId>:<0\|1>` |
| `free_tickets` | `provider` | VARCHAR(50) NULL | 動画券の広告事業者。事業者と繋いだときだけ入り、いまは NULL |
| `free_tickets` | `issued_at` | TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP | 発行日時。期限はここから数える |
| `free_tickets` | `expires_at` | TIMESTAMPTZ NOT NULL | 有効期限。紹介券は発行から3か月 |
| `free_tickets` | `used_at` | TIMESTAMPTZ NULL | 消費した日時。NULL は未使用 |
| `free_tickets` | `event_id` | UUID NULL | どのイベントの公開で使ったか（分析用）。外部キーは張らず、イベントを消しても行を残す |
| `free_tickets` | `created_at` | TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP | 行を作った日時 |
| `users` | `referral_code` | VARCHAR(12) NULL UNIQUE | 紹介URLに載せる8文字のコード。既存行は NULL で、初めて紹介を開いたときに作る。退会後も残す |
| `users` | `referred_by_user_id` | UUID NULL | 誰の紹介で登録したか。会員になった時点で確定し、後から変えない。自己紹介は入れない |
| `signup_intents` | `referral_code` | VARCHAR(12) NULL | 登録の途中で持つ紹介コード。会員になった時点で `users.referred_by_user_id` へ確定する |
| `notifications` | `event_id` | UUID NULL（既存の列を NULL 可へ） | 通知の元になった催し。`REFERRAL_GRANTED` は催しに紐づかないため NULL |

- `users.referral_code` の UNIQUE が、コードの重複を DB で止める。作るのは `ensureReferralCode` で、衝突したら作り直す。
- `free_tickets.reason_key` の UNIQUE が、同じ人の同じ付与を1回に抑える。付与は `FOR UPDATE` で紹介者の行を押さえてから枚数を数え、生涯 10 枚を超えない。
- 消費する順は 定額 → チケット（`expires_at` の昇順）→ 単発クレジット → 無料枠。期限切れの券は選ばない。

---

### 4.6. パスワード再設定（追加マイグレーション）

`prisma/migrations/20261105120000_password_reset_tokens/migration.sql` で追加する。仕様は [バックエンド API §8.18](backend_api_implementation_spec.md) を正とする。形は `email_change_requests` と同じで、会員に紐づく 1 回限りのトークンを持つ。

#### Prisma モデル（抜粋）

```text
/// パスワード再設定の保留中。メールのリンクを開くと確定する。
model PasswordResetToken {
  id        String    @id @default(uuid()) @db.Uuid
  userId    String    @map("user_id") @db.Uuid
  tokenHash String    @unique @map("token_hash") @db.VarChar(64)
  expiresAt DateTime  @map("expires_at") @db.Timestamptz
  usedAt    DateTime? @map("used_at") @db.Timestamptz
  createdAt DateTime  @default(now()) @map("created_at") @db.Timestamptz

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId])
  @@map("password_reset_tokens")
}
```

`User` 側に `passwordResetTokens PasswordResetToken[]` を足す。

#### 追加テーブル（`password_reset_tokens`）

```sql
-- パスワード再設定の保留中。メールのリンクを開くと確定する。
CREATE TABLE password_reset_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash VARCHAR(64) UNIQUE NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    used_at TIMESTAMPTZ NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_password_reset_tokens_user ON password_reset_tokens(user_id);
```

#### 列の意味

| テーブル | 列 | 型 | 意味 |
| :---- | :---- | :---- | :---- |
| `password_reset_tokens` | `id` | UUID PK | トークン1件の識別子 |
| `password_reset_tokens` | `user_id` | UUID NOT NULL（`users` へ ON DELETE CASCADE） | 再設定する会員。退会時にこの行も消える |
| `password_reset_tokens` | `token_hash` | VARCHAR(64) UNIQUE NOT NULL | 平文トークンの SHA-256。平文は保存しない |
| `password_reset_tokens` | `expires_at` | TIMESTAMPTZ NOT NULL | 有効期限。発行から30分 |
| `password_reset_tokens` | `used_at` | TIMESTAMPTZ NULL | 確定した日時。NULL は未使用で、1回限り |
| `password_reset_tokens` | `created_at` | TIMESTAMPTZ NOT NULL DEFAULT NOW() | 行を作った日時 |

- `token_hash` の UNIQUE が、同じ URL の二重利用を DB でも止める。確定は `used_at IS NULL` の行だけを更新し、0 件なら 400 `RESET_TOKEN_INVALID`。
- 発行し直すときは、その会員の未使用行を消してから新しい行を作る。前のリンクは無効になる。

---

### 4.7. リマインドメールの送信記録（追加マイグレーション・未実装）

`prisma/migrations/20261020053000_visibility_flyers_reminders/migration.sql` で追加する。同じマイグレーションがチラシの `is_deleted` と催しの `rain_policy` / `capacity` / `is_deleted` も足すが、ここでは送信記録だけを扱う。

> **未実装（pending）:** この表はモデルと表だけが先にあり、書き込みも読み出しもしません。リマインドの送信バッチ（`scripts/billing-notices.mjs` は別の通知を持つ）は pending です。`status` に入る値（`SENT` / `FAILED` など）と文面もまだ決めていません。実装するときに、この節へ値と文面を書き足してください。

#### Prisma モデル（抜粋）

```text
// =============================================================
// 9. リマインドメールの送信記録
// =============================================================

model ReminderDelivery {
  id             String   @id @default(uuid()) @db.Uuid
  eventId        String   @map("event_id") @db.Uuid
  recipientEmail String   @map("recipient_email") @db.VarChar(255)
  subject        String   @db.VarChar(200)
  body           String   @db.Text
  status         String   @db.VarChar(20)
  createdAt      DateTime @default(now()) @map("created_at") @db.Timestamptz

  event Event @relation(fields: [eventId], references: [id], onDelete: Cascade)

  @@index([eventId, createdAt])
  @@map("reminder_deliveries")
}
```

`Event` 側に `reminders ReminderDelivery[]` を足す。

#### 追加テーブル（`reminder_deliveries`）

```sql
-- リマインドメールの送信記録。
CREATE TABLE "reminder_deliveries" (
    "id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "recipient_email" VARCHAR(255) NOT NULL,
    "subject" VARCHAR(200) NOT NULL,
    "body" TEXT NOT NULL,
    "status" VARCHAR(20) NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reminder_deliveries_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "reminder_deliveries_event_id_created_at_idx"
  ON "reminder_deliveries"("event_id", "created_at");

ALTER TABLE "reminder_deliveries" ADD CONSTRAINT "reminder_deliveries_event_id_fkey"
  FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;
```

#### 列の意味

| テーブル | 列 | 型 | 意味 |
| :---- | :---- | :---- | :---- |
| `reminder_deliveries` | `id` | UUID PK | 送信1件の識別子 |
| `reminder_deliveries` | `event_id` | UUID NOT NULL（`events` へ ON DELETE CASCADE） | どの催しのリマインドか。催しを消すと記録も消える |
| `reminder_deliveries` | `recipient_email` | VARCHAR(255) NOT NULL | 宛先のメールアドレス。会員に紐づけず、送った時点の値を残す |
| `reminder_deliveries` | `subject` | VARCHAR(200) NOT NULL | 件名 |
| `reminder_deliveries` | `body` | TEXT NOT NULL | 本文。送った文面をそのまま残す |
| `reminder_deliveries` | `status` | VARCHAR(20) NOT NULL | 送信の結果。値は未確定（列挙型にせず、実装時に決める） |
| `reminder_deliveries` | `created_at` | TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP | 送った日時 |

- 同じ宛先へ二重に送らないための UNIQUE は無い。重複の抑制は実装側で持つ。
- `recipient_email` は `users` を参照しない。退会やアドレス変更で、過去に送った記録が書き換わらないようにするため。

---

## 5. CRUD操作詳細仕様（トランザクション＆アトミック処理）

### 5.1. イベント新規作成（課金認可ゲート判定＆チケット消費）

```ts
import { prisma } from '@/lib/prisma';

export async function createEventWithQuotaGate(
  userId: string,
  input: {
    title: string;
    schedules: { eventDate: string; eventTime: string }[];
    pricePlans: { name: string; price: string }[];
    location: string;
    rainPolicy: any;
    capacity?: number;
    flyerAssetId?: string;
  }
) {
  return await prisma.$transaction(async (tx) => {
    // 1. クォータレコード取得
    const quota = await tx.userUsageQuota.findUniqueOrThrow({
      where: { userId },
    });
    const now = new Date();
    let isAuthorized = false;
    // ① サブスクリプション判定 (最優先・チケット消費なし)
    if (
      quota.subscriptionStatus === 'ACTIVE' &&
      quota.currentPeriodEnd &&
      quota.currentPeriodEnd > now
    ) {
      isAuthorized = true;
    }
    // ② 単発クレジット判定 (第2優先・クレジットを1デクリメント)
    else if (quota.paidCredits >= 1) {
      await tx.userUsageQuota.update({
        where: { userId },
        data: { paidCredits: { decrement: 1 } },
      });
      isAuthorized = true;
    }
    // ③ 無料チケット判定 (第3優先・累計利用数を1インクリメント)
    else if (quota.freeEventCount < 2) {
      await tx.userUsageQuota.update({
        where: { userId },
        data: { freeEventCount: { increment: 1 } },
      });
      isAuthorized = true;
    }
    if (!isAuthorized) {
      const error: any = new Error('QUOTA_EXCEEDED');
      error.status = 402;
      throw error;
    }
    // 2. イベント本体作成
    const event = await tx.event.create({
      data: {
        title: input.title,
        sortDate: new Date(input.schedules[0].eventDate),
        location: input.location,
        schedules: { create: input.schedules.map((row, sortOrder) => ({ eventDate: new Date(row.eventDate), eventTime: row.eventTime, sortOrder })) },
        pricePlans: { create: input.pricePlans.map((row, sortOrder) => ({ name: row.name, price: row.price, sortOrder })) },
        rainPolicy: input.rainPolicy,
        capacity: input.capacity || null,
        flyerAssetId: input.flyerAssetId || null,
        // 一覧を持たないため常に紹介制。値は将来のメディアサイト用に残す。
        visibility: 'UNLISTED',
        status: 'PUBLISHED',
      },
    });
    // 3. 主催者ロール（OWNER）を付与
    await tx.eventOrganizer.create({
      data: {
        eventId: event.id,
        userId: userId,
        role: 'OWNER',
      },
    });
    return event;
  });
}
```

---

### 5.2. Webhook 冪等性トランザクション（単発クレジット付与 / サブスク更新）

```ts
export async function handleStripeWebhookEvent(event: any) {
  return await prisma.$transaction(async (tx) => {
    // 1. 冪等性チェック（二重処理遮断）
    const existing = await tx.stripeWebhookEvent.findUnique({
      where: { stripeEventId: event.id },
    });
    if (existing) {
      return { skipped: true };
    }
    // イベントID記録
    await tx.stripeWebhookEvent.create({
      data: {
        stripeEventId: event.id,
        eventType: event.type,
      },
    });
    // 2. イベント種別ハンドリング
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;
      const userId = session.metadata?.userId;
      if (session.mode === 'payment') {
        // 単発決済完了: paidCredits + 1
        await tx.userUsageQuota.update({
          where: { userId },
          data: { paidCredits: { increment: 1 } },
        });
        await tx.billingTransaction.updateMany({
          where: { stripeCheckoutSessionId: session.id },
          data: { paymentStatus: 'SUCCEEDED' },
        });
      } else if (session.mode === 'subscription') {
        // サブスク初回加入
        await tx.userUsageQuota.update({
          where: { userId },
          data: {
            subscriptionStatus: 'ACTIVE',
            stripeSubscriptionId: session.subscription,
            stripeCustomerId: session.customer,
          },
        });
      }
    } else if (event.type === 'invoice.payment_succeeded') {
      const invoice = event.data.object;
      const customerId = invoice.customer;
      const periodEnd = new Date(invoice.lines.data[0].period.end * 1000);
      await tx.userUsageQuota.update({
        where: { stripeCustomerId: customerId },
        data: {
          subscriptionStatus: 'ACTIVE',
          currentPeriodEnd: periodEnd,
        },
      });
    }
    return { success: true };
  });
}
```

---

### 5.3. PostgreSQL アトミック排他ロッククエリ (Raw SQL)

```sql
-- 排他編集ロックの取得・再確認（失効なし）
INSERT INTO event_locks (
  event_id,
  locked_by_user_id,
  locked_by_token_hash,
  lock_holder_name,
  lock_token_hash,
  updated_at
) VALUES (
  :eventId,
  :userId,
  :tokenHash,
  :holderName,
  :newLockTokenHash,
  NOW()
)
ON CONFLICT (event_id) DO UPDATE
SET
  locked_by_user_id    = EXCLUDED.locked_by_user_id,
  locked_by_token_hash = EXCLUDED.locked_by_token_hash,
  lock_holder_name     = EXCLUDED.lock_holder_name,
  lock_token_hash      = EXCLUDED.lock_token_hash,
  updated_at           = NOW()
WHERE
  event_locks.lock_token_hash = :currentLockTokenHash;  -- 保持者自身の再確認のみ許可
```

---

### 5.4. イベント複製（Clone）トランザクション

```ts
export async function cloneEvent(sourceEventId: string, currentUserId: string) {
  return await prisma.$transaction(async (tx) => {
    // コピー元イベント取得
    const source = await tx.event.findUniqueOrThrow({
      where: { id: sourceEventId, isDeleted: false },
    });
    // 新規イベントレコード作成（出欠・ロック情報は初期化）
    const newEvent = await tx.event.create({
      data: {
        title: `${source.title} (コピー)`,
        sortDate: source.sortDate,
        schedules: { create: source.schedules.map((row) => ({ eventDate: row.eventDate, eventTime: row.eventTime, sortOrder: row.sortOrder })) },
        pricePlans: { create: source.pricePlans.map((row) => ({ name: row.name, price: row.price, sortOrder: row.sortOrder })) },
        location: source.location,
        rainPolicy: source.rainPolicy,
        capacity: source.capacity,
        flyerAssetId: source.flyerAssetId,
        // 複製も常に紹介制。
        visibility: 'UNLISTED',
        status: 'DRAFT',
      },
    });
    // 複製実行者を主催者として登録
    await tx.eventOrganizer.create({
      data: {
        eventId: newEvent.id,
        userId: currentUserId,
        role: 'OWNER',
      },
    });
  });
}
```

### 5.5. 退会（論理削除）と復帰のトランザクション

退会は `users` の行を消さない。確認済みの電話番号だけを残し、同じ番号で登録し直したときに前の行とチケット情報を引き継ぐ。無料チケットの使い回しを防ぐため、`user_usage_quotas` の `free_event_count` と `paid_credits` は戻さない。

```ts
export async function withdrawAccount(input: {
  userId: string;
  ipHash: string | null;
  cancelSubscription: (subscriptionId: string) => Promise<void>;
}) {
  const user = await prisma.user.findUnique({
    where: { id: input.userId },
    select: { platformRole: true, deletedAt: true, quota: { select: { stripeSubscriptionId: true, subscriptionStatus: true } } },
  });
  if (!user || user.deletedAt) throw userNotFound();
  if (user.platformRole === 'ADMIN') throw adminCannotWithdraw(); // 403

  // Stripe の解約に失敗したら退会を進めない。
  const subscriptionId = user.quota?.stripeSubscriptionId ?? null;
  if (subscriptionId && user.quota?.subscriptionStatus !== 'CANCELED') {
    await input.cancelSubscription(subscriptionId); // 失敗は 502
  }

  const now = new Date();
  await prisma.$transaction(async (tx) => {
    // 主催者のイベントだけ閉じる。共同主催・幹事の紐付けは外し、他の主催者のイベントは残す。
    await tx.event.updateMany({
      where: { isDeleted: false, organizers: { some: { userId: input.userId, role: 'OWNER' } } },
      data: { isDeleted: true, status: 'CLOSED' },
    });
    await tx.eventOrganizer.deleteMany({ where: { userId: input.userId, role: 'CO_HOST' } });

    // 電話番号は残す。メールアドレスは解放し、別の会員が使えるようにする。
    await tx.user.update({
      where: { id: input.userId },
      data: {
        deletedAt: now,
        name: '退会した会員',
        email: `deleted+${input.userId}@deleted.invalid`,
        emailVerifiedAt: null,
        passwordHash: null,
        googleSub: null,
      },
    });
    await tx.userUsageQuota.updateMany({
      where: { userId: input.userId, stripeSubscriptionId: subscriptionId },
      data: {
        stripeSubscriptionId: null,
        subscriptionStatus: 'CANCELED',
        currentPeriodEnd: null,
        discountEndsAt: null,
        discountPercent: null,
        pricingCampaignId: null,
      },
    });
    await tx.authSession.updateMany({
      where: { userId: input.userId, revokedAt: null },
      data: { revokedAt: now },
    });
    await tx.emailChangeRequest.deleteMany({ where: { userId: input.userId } });
    await tx.phoneVerificationCode.deleteMany({ where: { userId: input.userId } });
    await tx.emailVerificationToken.deleteMany({ where: { userId: input.userId } });
    await tx.loginChallenge.deleteMany({ where: { userId: input.userId, usedAt: null } });
    await tx.accountChangeLog.create({ data: { userId: input.userId, kind: 'WITHDRAW', ipHash: input.ipHash } });
  });
}
```

復帰は、電話番号確認の完了時（`POST /api/v1/auth/phone/confirm`）に、同じ確認済み `phone_e164` の行が退会済みだったときに行う。

```ts
const target = bySub ?? byEmail ?? byPhone;
if (target?.deletedAt) {
  const user = await tx.user.update({
    where: { id: target.id },
    data: {
      deletedAt: null,
      email: intent.email,
      name: intent.name,
      passwordHash: intent.passwordHash,
      googleSub: intent.googleSub,
      emailVerifiedAt: intent.emailVerifiedAt ?? new Date(),
      phoneE164,
      phoneVerifiedAt: target.phoneVerifiedAt ?? new Date(),
    },
  });
  // update: {} なので、消化済みの無料チケットは戻らない。
  await tx.userUsageQuota.upsert({ where: { userId: user.id }, create: { userId: user.id }, update: {} });
  await tx.accountChangeLog.create({ data: { userId: user.id, kind: 'REACTIVATE' } });
  await tx.signupIntent.delete({ where: { id: intentId } });
  return { user, attachedExisting: true, reactivated: true };
}
```

`account_change_logs` は追記のみとする。退会で会員が消えても記録は残すため、`user_id` は `ON DELETE SET NULL` とする。値はマスク済みだけを入れ、パスワードは入れない。`ip_hash` は IP の SHA-256 である。