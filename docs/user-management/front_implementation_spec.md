# フロントエンド画面・コンポーネント実装設計書

## イベント主催者・参加者向け 権限管理＆段階的会員基盤（React / Next.js App Router / Tailwind CSS）

## 1. フロントエンド全体アーキテクチャ方針

### 1.1. 技術スタック・選定基準

* **Framework:** Next.js (App Router / React 18+)
* **Language:** TypeScript 5.0+（厳格モード `strict: true`）
* **Styling:** Tailwind CSS（コンポーネントの可読性・自己完結性を担保）
* **Server State Management:** TanStack Query (React Query v5)
  * キャッシュ無効化、ポーリング、バックグラウンドフェッチ、楽観的UI更新を標準化。
* **Local State Management:** Zustand または React Context
  * 編集ロック状態、ローカル端末トークン保持、グローバル通知（Toast）の管理。
* **Form & Validation:** React Hook Form + Zod
  * ゼロフリクション入力フォームの軽量化とスキーマ駆動バリデーション。
* **Icon:** Lucide React

### 1.2. 画面一覧・ルーティング規約

| 画面名 | パス (App Router) | 想定アクター | 認可・状態要件 |
| :--- | :--- | :--- | :--- |
| **イベント公開・回答画面** | `/events/[id]` | 全員（ゲスト/会員） | 誰でも閲覧可能。端末トークン有無で「新規回答」と「回答照会・変更」を自動切替。 |
| **イベント新規作成画面** | `/events/new` | 主催者（ゲスト/会員） | 誰でもアクセス可能。作成確定時に「会員登録モーダル（スキップ可）」を表示。 |
| **幹事管理ダッシュボード** | `/manage/events/[id]` | 幹事（ゲスト幹事/会員幹事） | 幹事トークンまたは会員セッション必須。参加者一覧表示・招待コード発行。 |
| **イベント編集画面** | `/manage/events/[id]/edit` | 幹事（排他ロック保持者） | 単一編集ロック（Lease Lock）が必須。他者編集中はRead-Only＆引き継ぎUI表示。 |
| **共同幹事招待受託画面** | `/invite/events` | 招待されたユーザー | クエリ `?invite_code=...` を受け取り、幹事権限を付与して管理画面へリダイレクト。 |
| **会員マイページ** | `/mypage` | 認証済み会員 | 会員認証必須。主催イベント一覧（複製作成機能付き）および参加イベント一覧。 |

---

## 2. 画面遷移図（Screen Transition Diagrams）

### 2.1. 全体画面遷移俯瞰マップ

システム全体における画面間の接続関係と、認証/認可による分岐の全体像である。

```text
                                 ┌─────────────────────────┐
                                 │     [トップ / LP]       │
                                 └───────────┬─────────────┘
                                             │
                        ┌────────────────────┴───────────────────┐
                        │ 「イベントを作る」                     │ 共有リンク受取
                        ▼                                        ▼
             ┌─────────────────────┐                  ┌─────────────────────┐
             │  イベント新規作成   │                  │  イベント公開・出欠 │
             │   (/events/new)     │                  │    (/events/[id])   │
             └──────────┬──────────┘                  └──────────┬──────────┘
                        │ 作成実行                               │
                        ▼                                        │ 端末Cookie判定
             ┌─────────────────────┐                   ┌─────────┴─────────┐
             │ 会員登録モーダル    │                   │                   │
             │ (推奨 / スキップ可) │              [未回答端末]        [回答済端末]
             └────┬───────────┬────┘                   │                   │
  [会員登録]      │           │ [スキップ]             ▼                   ▼
                  ▼           ▼                ┌──────────────┐    ┌──────────────┐
  ┌─────────────────┐   ┌──────────────────┐   │ 新規回答Form │    │ 自回答照会   │
  │ 会員幹事確定    │   │ ゲスト幹事確定   │   │ (名前・出欠) │    │ (変更・取消) │
  │ (User IDバインド)   │ (管理URL/Cookie) │   └──────┬───────┘    └──────────────┘
  └───────┬─────────┘   └────────┬─────────┘          │ 回答完了
          │                      │                    ▼
          └──────────┬───────────┘             ┌─────────────────────────┐
                     │                         │ 端末CookieにToken保存   │
                     ▼                         │ ＋ 会員化プロモーション │
          ┌─────────────────────┐              └────────────┬────────────┘
          │ 幹事ダッシュボード  │                           │
          │ (/manage/events/:id)│                           │ 「会員登録して履歴を残す」
          └──────┬───────┬──────┘                           ▼
  [共同幹事招待] │       │ [編集する]              ┌─────────────────────────┐
                 │       │                         │ 会員登録・ログイン画面  │
                 │       ▼                         │ (/login or /register)   │
                 │ ┌──────────────────────┐        └────────────┬────────────┘
                 │ │    排他ロック判定    │                     │
                 │ └─┬──────────────────┬─┘                     │ アカウント昇格 (Hydrate)
                 │   │ ロック取得成功   │ ロック競合 (編集中)   ▼
                 │   ▼                  ▼              ┌─────────────────────────┐
                 │ ┌────────────────┐ ┌──────────────┐ │     会員マイページ      │
                 │ │ イベント編集   │ │ 編集中ロック │ │        (/mypage)        │
                 │ │ フォーム活性   │ │ ブロッカー   │ ├─────────────────────────┤
                 │ └────────────────┘ └──────────────┘ │ [主催一覧]  [参加一覧]  │
                 │                                     │     │                   │
                 ▼                                     │     ▼ (ワンクリック複製)│
          ┌─────────────────────┐                      │ [イベント新規作成画面]  │
          │ 共同幹事招待リンク  │                      └─────────────────────────┘
          │ (/invite/events)    │
          └─────────────────────┘
```

---

### 2.2. アクター別詳細遷移フロー

#### A. 参加者（ゲスト参加者）の遷移
アカウントを持たないユーザーが参加登録し、後から確認・変更し、最終的に会員化するまでの遷移。

```text
[幹事から届いたURL]
       │
       ▼
┌────────────────────────────────────────────────────────┐
│ イベント公開画面 (/events/[id])                        │
│                                                        │
│  ┌──────────────────────────────────────────────────┐  │
│  │ 端末Cookie (rsvp_token) をチェック               │  │
│  └───────────────┬──────────────────┬───────────────┘  │
│                  │ なし             │ あり             │
│                  ▼                  ▼                  │
│       ┌──────────────────┐ ┌──────────────────┐        │
│       │ 新規出欠フォーム │ │ 自身の回答状況   │        │
│       │ ・お名前 (必須)  │ │ ・現在のステータス │        │
│       │ ・出欠ステータス │ │ ・コメント       │        │
│       │ ・コメント       │ └────────┬─────────┘        │
│       └────────┬─────────┘          │                  │
│                │ 送信完了           │ 「変更する」     │
│                ▼                    ▼                  │
│       ┌──────────────────┐ ┌──────────────────┐        │
│       │ 完了メッセージ   │ │ 編集フォーム展開 │        │
│       │ ＋TokenCookie付与│ │ (即時PUT更新)    │        │
│       └────────┬─────────┘ └──────────────────┘        │
│                │                                       │
│                ▼                                       │
│  ┌──────────────────────────────────────────────────┐  │
│  │ [昇格バナー]                                     │  │
│  │ 「会員登録すると参加イベントを一覧で保存できます」│  │
│  └───────────────────────┬──────────────────────────┘  │
└──────────────────────────┼─────────────────────────────┘
                           │ 会員登録へ進む
                           ▼
┌────────────────────────────────────────────────────────┐
│ 会員登録 (OAuth / マジックリンク)                      │
│                                                        │
│  ※完了時に端末内の全 rsvp_token をバックエンドへ送信  │
│    (POST /api/v1/member/hydrate)                       │
└──────────────────────────┬─────────────────────────────┘
                           │
                           ▼
┌────────────────────────────────────────────────────────┐
│ 会員マイページ (/mypage) 参加履歴タブ                  │
│ ・今回参加したイベントが自動反映されている             │
└────────────────────────────────────────────────────────┘
```

---

#### B. 幹事（主催者）の作成・共同管理・複製遷移
幹事がイベントを立ち上げ、他幹事を招待し、終了後に過去イベントを再利用（複製）するまでの遷移。

```text
┌────────────────────────────────────────────────────────┐
│ イベント新規作成画面 (/events/new)                     │
│ ・タイトル、日時、場所、概要を入力                     │
└──────────────────────────┬─────────────────────────────┘
                           │ 「作成する」ボタン押下
                           ▼
┌────────────────────────────────────────────────────────┐
│ 会員登録モーダル                                       │
│ ├── [A: ログイン/新規登録して作成] ─> 会員幹事として確定
│ └── [B: 登録せずに今すぐ作成]     ─> ゲスト幹事として確定
└──────────────────────────┬─────────────────────────────┘
                           │
                           ▼
┌────────────────────────────────────────────────────────┐
│ 幹事管理ダッシュボード (/manage/events/[id])           │
│                                                        │
│  ├── 参加者一覧テーブル (幹事のみ閲覧可・氏名/出欠/時刻)│
│  │                                                     │
│  ├── [共同幹事の招待] ボタン押下                       │
│  │      ▼                                              │
│  │    [招待モーダル] ──> 招待URLをコピーして他幹事へ共有
│  │                                                     │
│  └── [イベント情報を編集する] ボタン押下               │
└──────────────────────────┬─────────────────────────────┘
                           │
                           ▼
┌────────────────────────────────────────────────────────┐
│ イベント編集画面 (/manage/events/[id]/edit)            │
│ (※次節 2.3 の排他制御ステートマシンにより遷移)        │
└────────────────────────────────────────────────────────┘
                           │ (イベント終了・次回開催時)
                           ▼
┌────────────────────────────────────────────────────────┐
│ 会員マイページ (/mypage) 主催イベントタブ              │
│                                                        │
│  ┌──────────────────────────────────────────────────┐  │
│  │ 過去主催イベントカード                           │  │
│  │ [このイベントをコピーして新規作成] ボタン        │  │
│  └───────────────────────┬──────────────────────────┘  │
└──────────────────────────┼─────────────────────────────┘
                           │ 押下 (POST .../clone)
                           ▼
┌────────────────────────────────────────────────────────┐
│ 新規作成画面（/events/new）※値引き継ぎ状態            │
│ ・タイトル: 「〇〇 のコピー」                          │
│ ・場所/説明: コピー元を保持                            │
│ ・日時/参加者/ロック: 空白（リセット）                 │
└────────────────────────────────────────────────────────┘
```

---

### 2.3. 排他リースロックの画面状態遷移（State Machine）

複数幹事による同時編集画面アクセス時のUI状態遷移とフォールバック設計である。

```text
               [幹事ダッシュボードで「編集する」を押下]
                                  │
                                  ▼
               ┌──────────────────────────────────────┐
               │         画面初期化・ロック取得       │
               │   POST /api/v1/organizer/events/:id/lock
               └──────────────────┬───────────────────┘
                                  │
         ┌────────────────────────┴────────────────────────┐
         │ 200 OK (ロック獲得)                             │ 409 Conflict (他者が編集中)
         ▼                                                 ▼
┌─────────────────────────────────┐       ┌─────────────────────────────────┐
│ 【状態: ACTIVE】                │       │ 【状態: LOCKED_BY_OTHER】       │
│ ・全入力フォームが活性化        │       │ ・フォームは非活性 (Read-Only)  │
│ ・上部に「編集権保持中」バッジ  │       │ ・画面上にロック競合モーダル表示│
│ ・30秒毎にハートビート自動送信  │       │ ・「〇〇さんが編集中」表示      │
│   (PUT .../lock でTTL 180s延長) │       │ ・残り秒数カウントダウン (MM:SS)│
└────────┬───────────────┬────────┘       └────────┬───────────────┬────────┘
         │               │                         │               │
 [保存/完了]     [他幹事Takeover]       [閲覧のみ選択]   [引き継ぐ選択]
         │        (次回Heartbeatで検知)            │               │
         │               │                         ▼               ▼
         │               ▼              ┌──────────────┐ ┌──────────────────┐
         │       ┌──────────────┐       │ 閲覧モード   │ │ 強制引き継ぎ     │
         │       │【状態: LOST】│       │ ・モーダル閉 │ │ POST .../takeover│
         │       │・編集権剥奪  │       │ ・変更不可   │ └────────┬─────────┘
         │       │・ダイアログ  │       └──────────────┘          │ 200 OK
         │       │  「他幹事が  │                                  │
         │       │   引き継ぎ」 │                                  ▼
         │       └──────────────┘                         ┌──────────────────┐
         ▼                                                │ 【状態: ACTIVE】 │
┌─────────────────────────────────┐                       │ ・自セッションが │
│ 【ロック解放 & 画面遷移】       │                       │   新たなロック   │
│ DELETE .../lock 送信            │                       │   を獲得         │
│ 幹事ダッシュボードへ戻る        │                       └──────────────────┘
└─────────────────────────────────┘
```

---

## 3. 状態管理＆カスタムフック設計

### 3.1. 排他リースロック制御フック (`useEditLock`)

編集画面での「180秒リースロック」「30秒毎ハートビート」「他者編集中ブロッカー」「強制引き継ぎ（Takeover）」「画面離脱時のロック解放」を一元管理する中核フック。

```text
【ライフサイクル】
  Mount
    │
    ├─> POST /api/v1/organizer/events/:id/lock (ロック取得試行)
    │     ├── 200 OK: ロック獲得 -> state: 'ACTIVE' -> 30秒毎に PUT (ハートビート開始)
    │     └── 409 Conflict: ロック競合 -> state: 'LOCKED_BY_OTHER' (残り秒数カウントダウン)
    │
    ├─> ユーザーが「引き継ぐ」押下 -> POST /takeover -> state: 'ACTIVE'
    │
  Unmount / 完了
    │
    └─> DELETE /api/v1/organizer/events/:id/lock (ロック明示解放)
```

#### TypeScriptインターフェース定義

```typescript
export type LockStatus = "ACQUIRING" | "ACTIVE" | "LOCKED_BY_OTHER" | "LOST" | "ERROR";

export interface LockState {
  status: LockStatus;
  lockToken: string | null;
  holderName: string | null;
  remainingSeconds: number;
  canTakeover: boolean;
  takeover: () => Promise<boolean>;
  releaseLock: () => Promise<void>;
}
```

### 3.2. ゲスト端末トークン永続化フック (`useGuestTokens`)

未登録ユーザーが出欠登録した際の発行トークン群を、ローカルストレージとCookieで永続化し、会員登録時のアカウント昇格（Account Hydration）に備えるフック。

* **Storage Key:** `rsvp_guest_tokens` (Array of string)
* **Organize Key:** `organizer_guest_tokens` (Array of string)

```typescript
export interface GuestTokenManager {
  addRsvpToken: (token: string) => void;
  getRsvpTokens: () => string[];
  addOrganizerToken: (token: string) => void;
  getOrganizerTokens: () => string[];
  clearAllTokens: () => void;
}
```

---

## 4. 画面別UI・コンポーネント詳細設計

### 4.1. イベント公開・出欠画面 (`/events/[id]`)

#### コンポーネントツリー

```text
EventPublicPage
 ├── EventHeroHeader (タイトル、開催日時、場所、概要)
 ├── RsvpSummaryBadge (現在の参加/不参加人数の集計表示)
 ├── DynamicRsvpContainer
 │    ├── [未回答端末時] NewRsvpForm (名前・出欠ステータス・コメント入力)
 │    └── [回答済み端末時] MyRsvpCard (自身の回答内容・ステータス更新・変更ボタン)
 └── HydrationPromotionBanner (未ログイン時: 「会員登録すると過去の参加履歴が保存されます」)
```

#### 状態遷移フロー
1. ページロード時、`GET /api/v1/public/events/:id/my-rsvp` を呼び出す。
2. **200 OKの場合:** `MyRsvpCard` を表示。ユーザーはいつでも「出席」「欠席」の切り替えが可能。
3. **404 Not Foundの場合:** `NewRsvpForm` を表示。送信完了後、発行された `response_token` をローカルに保存し、自動的に `MyRsvpCard` 表示へ昇格。

### 4.2. 幹事管理ダッシュボード (`/manage/events/[id]`)

#### コンポーネントツリー

```text
OrganizerDashboardPage
 ├── DashboardNavBar (ステータス表示、編集画面リンク、公開ページ確認ボタン)
 ├── EventSummaryCard (タイトル、開催日時、場所のクイックプレビュー)
 ├── ActionActionBar
 │    ├── LinkToEditButton (編集画面へ遷移)
 │    └── OpenInviteModalButton (共同幹事招待モーダルを開く)
 ├── ParticipantStatsCards (参加・不参加・未定のカウントボックス)
 ├── ParticipantFilterBar (ステータス別絞り込み・検索バー)
 ├── ParticipantTable (氏名、出欠ステータス、コメント、登録日時一覧)
 └── CoOrganizerInviteModal (招待用URLの生成・ワンクリックコピー)
```

#### 主なコンポーネント責務
* **`ParticipantTable`:** 幹事認証付きAPI（`GET /api/v1/organizer/events/:id/participants`）から取得した個人情報リストを表示。参加者には非公開の機微データをテーブル表示。
* **`CoOrganizerInviteModal`:** `POST /api/v1/organizer/events/:id/invite` を呼び出し、発行されたワンタイム招待URLをクリップボードにコピー可能とする。

### 4.3. イベント編集画面・排他リースロック (`/manage/events/[id]/edit`)

#### コンポーネントツリー

```text
EventEditPage
 ├── LockStatusBar (ロック残り時間バー、ハートビート中インジケータ)
 ├── [他者編集中時] EditLockModal / EditLockOverlay
 │    ├── LockConflictMessage (「現在 〇〇 さんが編集中です」)
 │    ├── AutoReleaseCountdown (「自動解放まで残り 1分45秒」)
 │    ├── ReadOnlyPreviewButton (閲覧モードで確認)
 │    └── ForceTakeoverButton (「編集権を引き継ぐ」)
 └── EventEditForm (タイトル、日時、場所、説明の編集フォーム)
       ├── FormInputFields (Fieldset: 他者ロック時は disabled)
       └── FormActionButtons
             ├── CancelButton (変更を破棄してロック解放)
             └── SubmitSaveButton (保存してロック解放)
```

#### 排他制御のUI動作仕様
* **ロック取得成功時:** フォームは全入力フィールドが活性化。上部に緑色のバッジ「編集権を保持中（自動更新中）」を表示。
* **ロック競合時:** 画面全体に半透明のオーバーレイモーダルを表示。
  * 「〇〇さんが編集中です（残りXX秒）」
  * 「編集権を引き継ぐ」ボタンを押下すると、確認ダイアログ（「前の人の編集内容は破棄されますがよろしいですか？」）を表示後、Takeover APIを実行。

### 4.4. 会員マイページ (`/mypage`)

#### コンポーネントツリー

```text
MemberMyPage
 ├── UserProfileHeader (ユーザー名、メールアドレス)
 ├── HydrationSyncAlert (未同期のゲスト端末トークンが検知された場合の統合ボタン)
 ├── TabNavigation (「主催イベント」 / 「参加イベント」)
 ├── TabPanel: OrganizedEvents
 │    ├── CreateNewEventButton (新規作成画面へ)
 │    └── OrganizedEventCardList
 │          └── OrganizedEventCard (タイトル、開催日、参加人数、管理画面リンク)
 │                └── CloneEventButton (「このイベントをコピーして新規作成」)
 └── TabPanel: AttendedEvents
       └── AttendedEventCardList
             └── AttendedEventCard (イベント名、開催日、自身のステータス、公開ページリンク)
```

#### ワンクリック複製のUI仕様
* `CloneEventButton` を押下すると、`POST /api/v1/member/organized-events/:id/clone` を送信。
* 成功時、即座に新イベントの編集画面（`/manage/events/[new_id]/edit`）へ遷移し、日時のみを設定して即公開できる導線を提供する。

---

## 5. 主要コンポーネント＆カスタムフック実装コード

### 5.1. 排他ロック制御フック (`hooks/useEditLock.ts`)

```typescript
"use client";

import { useState, useEffect, useRef, useCallback } from "react";

interface LockResponse {
  locked: boolean;
  lock_token?: string;
  holder_name?: string;
  expires_at?: string;
  remaining_seconds?: number;
  can_takeover?: boolean;
}

export function useEditLock(eventId: string, organizerName: string) {
  const [status, setStatus] = useState<"ACQUIRING" | "ACTIVE" | "LOCKED_BY_OTHER" | "LOST">("ACQUIRING");
  const [lockToken, setLockToken] = useState<string | null>(null);
  const [holderName, setHolderName] = useState<string | null>(null);
  const [remainingSeconds, setRemainingSeconds] = useState<number>(180);

  const heartbeatTimerRef = useRef<NodeJS.Timeout | null>(null);
  const countdownTimerRef = useRef<NodeJS.Timeout | null>(null);

  // 1. ロック明示解放
  const releaseLock = useCallback(async () => {
    if (!lockToken) return;
    try {
      await fetch(`/api/v1/organizer/events/${eventId}/lock`, {
        method: "DELETE",
        headers: { "X-Lock-Token": lockToken },
      });
    } catch (e) {
      console.error("Failed to release lock", e);
    } finally {
      setLockToken(null);
      setStatus("LOST");
    }
  }, [eventId, lockToken]);

  // 2. ハートビート延長 (30秒間隔)
  const sendHeartbeat = useCallback(async (token: string) => {
    try {
      const res = await fetch(`/api/v1/organizer/events/${eventId}/lock`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lock_token: token }),
      });
      if (!res.ok) {
        // 他者に引き継がれたか失効
        setStatus("LOST");
        if (heartbeatTimerRef.current) clearInterval(heartbeatTimerRef.current);
      }
    } catch {
      setStatus("LOST");
    }
  }, [eventId]);

  // 3. ロック獲得試行
  const acquireLock = useCallback(async () => {
    setStatus("ACQUIRING");
    try {
      const res = await fetch(`/api/v1/organizer/events/${eventId}/lock`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ holder_name: organizerName }),
      });
      const data: LockResponse = await res.json();

      if (res.ok && data.locked && data.lock_token) {
        setLockToken(data.lock_token);
        setStatus("ACTIVE");
      } else {
        // 他幹事が編集中
        setStatus("LOCKED_BY_OTHER");
        setHolderName(data.holder_name || "他の幹事");
        setRemainingSeconds(data.remaining_seconds || 180);
      }
    } catch {
      setStatus("LOST");
    }
  }, [eventId, organizerName]);

  // 4. 強制引き継ぎ
  const takeoverLock = useCallback(async () => {
    try {
      const res = await fetch(`/api/v1/organizer/events/${eventId}/lock/takeover`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ holder_name: organizerName }),
      });
      const data: LockResponse = await res.json();
      if (res.ok && data.lock_token) {
        setLockToken(data.lock_token);
        setStatus("ACTIVE");
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }, [eventId, organizerName]);

  // ハートビートとカウントダウンのライフサイクル
  useEffect(() => {
    acquireLock();

    return () => {
      if (heartbeatTimerRef.current) clearInterval(heartbeatTimerRef.current);
      if (countdownTimerRef.current) clearInterval(countdownTimerRef.current);
      releaseLock();
    };
  }, [acquireLock, releaseLock]);

  useEffect(() => {
    if (status === "ACTIVE" && lockToken) {
      heartbeatTimerRef.current = setInterval(() => sendHeartbeat(lockToken), 30000);
    } else {
      if (heartbeatTimerRef.current) clearInterval(heartbeatTimerRef.current);
    }

    if (status === "LOCKED_BY_OTHER") {
      countdownTimerRef.current = setInterval(() => {
        setRemainingSeconds((prev) => (prev > 0 ? prev - 1 : 0));
      }, 1000);
    } else {
      if (countdownTimerRef.current) clearInterval(countdownTimerRef.current);
    }
  }, [status, lockToken, sendHeartbeat]);

  return {
    status,
    lockToken,
    holderName,
    remainingSeconds,
    takeoverLock,
    releaseLock,
    retryAcquire: acquireLock,
  };
}
```

### 5.2. ゼロフリクション出欠登録コンポーネント (`components/rsvp/DynamicRsvpBox.tsx`)

```tsx
"use client";

import React, { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { CheckCircle2, XCircle, HelpCircle, Loader2 } from "lucide-react";

const rsvpSchema = z.object({
  name: z.string().min(1, "名前を入力してください").max(100),
  status: z.enum(["ATTENDING", "DECLINED", "TENTATIVE"]),
  comment: z.string().max(255).optional(),
});

type RsvpFormData = z.infer<typeof rsvpSchema>;

interface Props {
  eventId: string;
  initialData?: {
    id: string;
    name: string;
    status: "ATTENDING" | "DECLINED" | "TENTATIVE";
    comment?: string;
  } | null;
}

export function DynamicRsvpBox({ eventId, initialData }: Props) {
  const [isEditing, setIsEditing] = useState(!initialData);
  const [currentRsvp, setCurrentRsvp] = useState(initialData);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const { register, handleSubmit, setValue, watch, formState: { errors } } = useForm<RsvpFormData>({
    resolver: zodResolver(rsvpSchema),
    defaultValues: {
      name: initialData?.name || "",
      status: initialData?.status || "ATTENDING",
      comment: initialData?.comment || "",
    },
  });

  const selectedStatus = watch("status");

  const onSubmit = async (data: RsvpFormData) => {
    setIsSubmitting(true);
    const endpoint = currentRsvp
      ? `/api/v1/public/events/${eventId}/my-rsvp`
      : `/api/v1/public/events/${eventId}/rsvp`;
    const method = currentRsvp ? "PUT" : "POST";

    try {
      const res = await fetch(endpoint, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });

      if (res.ok) {
        const result = await res.json();
        setCurrentRsvp({
          id: result.participant_id || currentRsvp?.id,
          name: data.name,
          status: data.status,
          comment: data.comment,
        });
        setIsEditing(false);
      }
    } catch (err) {
      console.error("出欠送信エラー", err);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isEditing && currentRsvp) {
    return (
      <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm">
        <div className="flex items-center justify-between pb-4 border-b border-gray-100">
          <div>
            <span className="text-xs font-semibold uppercase tracking-wider text-gray-400">あなたの回答</span>
            <h3 className="text-xl font-bold text-gray-900 mt-1">{currentRsvp.name} 様</h3>
          </div>
          <span className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-semibold ${
            currentRsvp.status === "ATTENDING" ? "bg-emerald-50 text-emerald-700 border border-emerald-200" :
            currentRsvp.status === "DECLINED" ? "bg-rose-50 text-rose-700 border border-rose-200" :
            "bg-amber-50 text-amber-700 border border-amber-200"
          }`}>
            {currentRsvp.status === "ATTENDING" && "出席"}
            {currentRsvp.status === "DECLINED" && "欠席"}
            {currentRsvp.status === "TENTATIVE" && "未定"}
          </span>
        </div>

        {currentRsvp.comment && (
          <p className="mt-4 text-sm text-gray-600 bg-gray-50 p-3 rounded-lg border border-gray-100">
            {currentRsvp.comment}
          </p>
        )}

        <button
          onClick={() => setIsEditing(true)}
          className="mt-5 w-full py-2.5 px-4 bg-gray-100 hover:bg-gray-200 text-gray-700 font-medium rounded-lg transition-colors text-sm"
        >
          回答内容を変更する
        </button>
      </div>
    );
  }

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm">
      <h3 className="text-lg font-bold text-gray-900 mb-4">
        {currentRsvp ? "出欠内容の変更" : "出欠を回答する（会員登録不要）"}
      </h3>
      
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">お名前 (ニックネーム可)</label>
          <input
            {...register("name")}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition text-sm"
            placeholder="山田 太郎"
          />
          {errors.name && <p className="text-xs text-rose-600 mt-1">{errors.name.message}</p>}
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">出欠ステータス</label>
          <div className="grid grid-cols-3 gap-2">
            {[
              { value: "ATTENDING", label: "出席", icon: CheckCircle2, color: "text-emerald-600 border-emerald-500 bg-emerald-50" },
              { value: "DECLINED", label: "欠席", icon: XCircle, color: "text-rose-600 border-rose-500 bg-rose-50" },
              { value: "TENTATIVE", label: "未定", icon: HelpCircle, color: "text-amber-600 border-amber-500 bg-amber-50" },
            ].map((option) => {
              const Icon = option.icon;
              const isSelected = selectedStatus === option.value;
              return (
                <button
                  type="button"
                  key={option.value}
                  onClick={() => setValue("status", option.value as any)}
                  className={`flex flex-col items-center justify-center py-3 px-2 border rounded-xl transition ${
                    isSelected ? option.color : "border-gray-200 hover:bg-gray-50 text-gray-600"
                  }`}
                >
                  <Icon className="w-5 h-5 mb-1" />
                  <span className="text-xs font-semibold">{option.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">コメント (任意)</label>
          <input
            {...register("comment")}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition text-sm"
            placeholder="少し遅れます、など"
          />
        </div>

        <div className="pt-2 flex gap-2">
          {currentRsvp && (
            <button
              type="button"
              onClick={() => setIsEditing(false)}
              className="w-1/3 py-2.5 px-4 bg-gray-100 hover:bg-gray-200 text-gray-700 font-medium rounded-lg transition text-sm"
            >
              キャンセル
            </button>
          )}
          <button
            type="submit"
            disabled={isSubmitting}
            className="flex-1 py-2.5 px-4 bg-indigo-600 hover:bg-indigo-700 text-white font-medium rounded-lg transition flex items-center justify-center text-sm"
          >
            {isSubmitting ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
            {currentRsvp ? "変更を確定する" : "この内容で回答を送信"}
          </button>
        </div>
      </form>
    </div>
  );
}
```

### 5.3. 排他編集ブロッカーモーダル (`components/organizer/LockConflictModal.tsx`)

```tsx
"use client";

import React from "react";
import { AlertCircle, Clock, ShieldAlert, ArrowRight } from "lucide-react";

interface Props {
  holderName: string;
  remainingSeconds: number;
  onTakeover: () => void;
  onViewReadOnly: () => void;
}

export function LockConflictModal({
  holderName,
  remainingSeconds,
  onTakeover,
  onViewReadOnly,
}: Props) {
  const minutes = Math.floor(remainingSeconds / 60);
  const seconds = remainingSeconds % 60;
  const timeFormatted = `${minutes}:${seconds.toString().padStart(2, "0")}`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-900/60 backdrop-blur-xs p-4">
      <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-gray-100 animate-in fade-in zoom-in-95 duration-150">
        <div className="w-12 h-12 rounded-full bg-amber-50 text-amber-600 flex items-center justify-center mx-auto mb-4 border border-amber-200">
          <ShieldAlert className="w-6 h-6" />
        </div>

        <h3 className="text-xl font-bold text-center text-gray-900">他の幹事が編集中です</h3>
        <p className="text-sm text-center text-gray-600 mt-2">
          現在、<span className="font-semibold text-gray-900">{holderName}</span> 様が編集画面を開いています。二重保存を防ぐためロックされています。
        </p>

        <div className="mt-5 bg-amber-50/60 border border-amber-200 rounded-xl p-3 flex items-center justify-center gap-2 text-amber-800">
          <Clock className="w-4 h-4 text-amber-600 animate-pulse" />
          <span className="text-xs font-medium">無操作による自動解放まで:</span>
          <span className="text-sm font-mono font-bold">{timeFormatted}</span>
        </div>

        <div className="mt-6 flex flex-col gap-2.5">
          <button
            onClick={onViewReadOnly}
            className="w-full py-2.5 px-4 bg-gray-100 hover:bg-gray-200 text-gray-800 font-medium rounded-xl text-sm transition"
          >
            閲覧モードで確認する（編集不可）
          </button>

          <button
            onClick={onTakeover}
            className="w-full py-2.5 px-4 bg-rose-600 hover:bg-rose-700 text-white font-medium rounded-xl text-sm transition flex items-center justify-center gap-2 shadow-sm shadow-rose-200"
          >
            <span>編集権を引き継ぐ（強制）</span>
            <ArrowRight className="w-4 h-4" />
          </button>
        </div>

        <p className="text-[11px] text-gray-400 text-center mt-3">
          ※引き継いだ場合、現在作業中の幹事の未保存内容は反映されません。
        </p>
      </div>
    </div>
  );
}
```

---

## 6. UI動作確認・シナリオテスト計画

フロントエンドとバックエンドの結合動作を保証するための4つの確認テストケースである。

| No | テストケース | 操作手順 | 期待されるUI挙動 |
| :--- | :--- | :--- | :--- |
| **TC-01** | **ゼロフリクション回答と自動照会** | 1. シークレットウィンドウで `/events/[id]` を開く<br>2. 「田中」出席で送信<br>3. ページをリロードする | 1. 新規回答フォームが表示される<br>2. 登録完了後、自身の回答カードに自動切り替わる<br>3. リロード後もCookieから自動認識され回答カードが表示される |
| **TC-02** | **排他ロック競合と引き継ぎ** | 1. ブラウザAで幹事として編集画面を開く<br>2. ブラウザBで同一イベントの編集画面を開く<br>3. ブラウザBで「編集権を引き継ぐ」を押下 | 1. ブラウザAは編集可能状態<br>2. ブラウザBに「他の幹事が編集中」モーダルが表示<br>3. ブラウザBが編集可能となり、ブラウザAに「他幹事に引き継がれました」と警告が表示される |
| **TC-03** | **共同幹事の招待と権限委譲** | 1. 幹事ダッシュボードで招待リンクを発行<br>2. 別ユーザー（未登録）がリンクを踏む | 1. ワンタイム招待URLがコピーされる<br>2. 幹事権限Cookieが付与され、参加者一覧が表示される管理ダッシュボードへ遷移する |
| **TC-04** | **過去イベントのワンクリック複製** | 1. 会員マイページで過去イベントの「コピーして新規作成」を押下 | 1. タイトルが「〇〇 のコピー」となり、日時は未設定の新規作成画面が立ち上がる |