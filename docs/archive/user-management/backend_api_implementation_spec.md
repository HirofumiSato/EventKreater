# バックエンドAPI実装仕様・サーバーコード設計書

> **実装前の設計文書です。** 現在の正は `prisma/schema.prisma` と `src/` のコードです。実装と差分があればコードを優先してください。

## イベント主催者・参加者向け 権限管理＆段階的会員基盤（Next.js App Router / Prisma / TypeScript）

## 1. サーバーアーキテクチャ・ディレクトリ構造

Next.js App Router (Route Handlers) を想定したバックエンド実装構成である。

```text
src/
├── app/
│   └── api/
│       └── v1/
│           ├── events/
│           │   └── route.ts                      # POST: イベント新規作成
│           ├── public/
│           │   └── events/
│           │       └── [id]/
│           │           ├── route.ts              # GET: イベント詳細（集計のみ）
│           │           ├── rsvp/
│           │           │   └── route.ts          # POST: ゲスト出欠登録
│           │           └── my-rsvp/
│           │               └── route.ts          # GET/PUT: 自回答の照会・変更
│           ├── organizer/
│           │   └── events/
│           │       ├── [id]/
│           │       │   ├── route.ts              # PUT: イベント更新 (ロック必須)
│           │       │   ├── participants/
│           │       │   │   └── route.ts          # GET: 参加者一覧 (幹事専用)
│           │       │   ├── lock/
│           │       │   │   ├── route.ts          # POST: ロック取得, PUT: ハートビート, DELETE: 解放
│           │       │   │   └── takeover/
│           │       │   │       └── route.ts      # POST: ロック強制引き継ぎ
│           │       │   └── invite/
│           │       │       └── route.ts          # POST: 招待URL発行
│           │       └── join-by-invite/
│           │           └── route.ts              # POST: 共同幹事受託
│           └── member/
│               ├── hydrate/
│               │   └── route.ts                  # POST: ゲスト履歴アカウント統合
│               └── organized-events/
│                   ├── route.ts                  # GET: 主催イベント一覧
│                   └── [id]/
│                       └── clone/
│                           └── route.ts          # POST: 過去イベント複製
├── lib/
│   ├── prisma.ts                                 # Prisma Client シングルトン
│   ├── crypto.ts                                 # トークン生成・SHA-256ハッシュユーティリティ
│   ├── response.ts                               # RFC 7807 準拠エラー・共通レスポンス
│   ├── guards.ts                                 # 幹事認可・排他ロック検証ガード
│   └── validations/
│       ├── event.schema.ts                       # イベントバリデーション
│       └── rsvp.schema.ts                        # 出欠バリデーション
```

---

## 2. 共通基盤モジュール実装

### 2.1. 暗号・トークンユーティリティ (`src/lib/crypto.ts`)

```typescript
import { createHash, randomBytes } from "node:crypto";

/**
 * 暗号学的に安全なランダム文字列トークンを生成
 */
export function generateSecureToken(prefix = "tok", length = 24): string {
  const bytes = randomBytes(length);
  const randomStr = bytes.toString("base64url").slice(0, length);
  return `${prefix}_${randomStr}`;
}

/**
 * トークンのSHA-256ハッシュ化（DB照合・保存用）
 */
export function hashToken(plainToken: string): string {
  return createHash("sha256").update(plainToken).digest("hex");
}
```

### 2.2. RFC 7807 準拠エラーハンドラー (`src/lib/response.ts`)

```typescript
import { NextResponse } from "next/server";

interface ApiProblemDetail {
  type: string;
  title: string;
  status: number;
  detail: string;
  instance?: string;
  errors?: Record<string, unknown>;
}

export function apiProblem(detail: ApiProblemDetail) {
  return NextResponse.json(detail, {
    status: detail.status,
    headers: { "Content-Type": "application/problem+json" },
  });
}

export function apiSuccess<T>(data: T, status = 200, headers?: HeadersInit) {
  return NextResponse.json(data, { status, headers });
}
```

### 2.3. 認可・ロック検証ガード (`src/lib/guards.ts`)

```typescript
import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { hashToken } from "@/lib/crypto";

export interface AuthContext {
  userId?: string;
  isGuestOrganizer: boolean;
}

/**
 * 幹事権限（会員幹事 または ゲスト幹事トークン）の存在を検証
 */
export async function assertOrganizer(req: NextRequest, eventId: string): Promise<AuthContext> {
  // 1. 会員ログインセッションの検証 (JWT / セッションCookie)
  const sessionToken = req.headers.get("authorization")?.replace("Bearer ", "") ||
                       req.cookies.get("session_token")?.value;

  if (sessionToken) {
    // 擬似コード: 既存認証プロバイダ (Supabase / NextAuth / Firebase) の検証
    const user = await prisma.user.findFirst({ where: { email: "dummy@example.com" } });
    if (user) {
      const isOrganizer = await prisma.eventOrganizer.findUnique({
        where: { eventId_userId: { eventId, userId: user.id } },
      });
      if (isOrganizer) {
        return { userId: user.id, isGuestOrganizer: false };
      }
    }
  }

  // 2. ゲスト幹事トークンの検証
  const plainToken = req.headers.get("x-guest-organizer-token") ||
                     req.cookies.get("guest_organizer_token")?.value;

  if (plainToken) {
    const hashed = hashToken(plainToken);
    const event = await prisma.event.findFirst({
      where: { id: eventId, guestOrganizerTokenHash: hashed },
      select: { id: true },
    });
    if (event) {
      return { isGuestOrganizer: true };
    }
  }

  throw new Error("FORBIDDEN_NOT_ORGANIZER");
}

/**
 * 編集排他リースロックの有効性を検証
 */
export async function assertLockHolder(req: NextRequest, eventId: string) {
  const lockToken = req.headers.get("x-lock-token");
  if (!lockToken) {
    throw new Error("LOCK_TOKEN_REQUIRED");
  }

  const activeLock = await prisma.editLock.findFirst({
    where: {
      eventId,
      lockedByToken: lockToken,
      expiresAt: { gt: new Date() }, // 有効期限内
    },
  });

  if (!activeLock) {
    throw new Error("LOCK_INVALID_OR_EXPIRED");
  }

  return activeLock;
}
```

---

## 3. エンドポイント実装コード

### 3.1. イベント新規作成 (`POST /api/v1/public/events`)

会員登録スキップ時（ゲスト幹事）と会員ログイン時の双方に対応する。

```typescript
// src/app/api/v1/public/events/route.ts
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { generateSecureToken, hashToken } from "@/lib/crypto";
import { apiProblem, apiSuccess } from "@/lib/response";

const createEventSchema = z.object({
  title: z.string().min(1, "タイトルは必須です").max(200),
  description: z.string().optional(),
  event_start_at: z.string().datetime().optional().nullable(),
  location: z.string().max(255).optional().nullable(),
});

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const parsed = createEventSchema.safeParse(body);
    if (!parsed.success) {
      return apiProblem({
        type: "https://api.example.com/errors/VALIDATION_ERROR",
        title: "Validation Error",
        status: 400,
        detail: "入力内容に不備があります。",
        errors: parsed.error.flatten().fieldErrors,
      });
    }

    // ログインセッション検証（任意）
    const authHeader = req.headers.get("authorization");
    let authenticatedUserId: string | null = null;
    if (authHeader) {
      // ユーザーID特定ロジック
      const user = await prisma.user.findFirst();
      authenticatedUserId = user?.id ?? null;
    }

    const { title, description, event_start_at, location } = parsed.data;

    if (authenticatedUserId) {
      // 会員幹事としての作成
      const event = await prisma.event.create({
        data: {
          title,
          description,
          eventStartAt: event_start_at ? new Date(event_start_at) : null,
          location,
          organizers: {
            create: {
              userId: authenticatedUserId,
              role: "OWNER",
            },
          },
        },
      });

      return apiSuccess({
        id: event.id,
        title: event.title,
        is_guest: false,
        manage_url: `/manage/events/${event.id}`,
      }, 201);
    } else {
      // ゲスト幹事としての作成（トークン発行）
      const plainToken = generateSecureToken("got", 32);
      const tokenHash = hashToken(plainToken);

      const event = await prisma.event.create({
        data: {
          title,
          description,
          eventStartAt: event_start_at ? new Date(event_start_at) : null,
          location,
          guestOrganizerTokenHash: tokenHash,
        },
      });

      const response = apiSuccess({
        id: event.id,
        title: event.title,
        is_guest: true,
        manage_url: `/manage/events/${event.id}?token=${plainToken}`,
        guest_organizer_token: plainToken,
      }, 201);

      // ゲスト幹事Cookie付与（30日間有効）
      response.cookies.set("guest_organizer_token", plainToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/",
        maxAge: 60 * 60 * 24 * 30,
      });

      return response;
    }
  } catch (error) {
    console.error("Failed to create event:", error);
    return apiProblem({
      type: "https://api.example.com/errors/INTERNAL_SERVER_ERROR",
      title: "Internal Server Error",
      status: 500,
      detail: "イベントの作成に失敗しました。",
    });
  }
}
```

---

### 3.2. ゼロフリクション出欠登録・照会API

#### 出欠登録 (`POST /api/v1/public/events/[id]/rsvp`)

```typescript
// src/app/api/v1/public/events/[id]/rsvp/route.ts
import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { generateSecureToken, hashToken } from "@/lib/crypto";
import { apiProblem, apiSuccess } from "@/lib/response";

const rsvpSchema = z.object({
  name: z.string().min(1, "名前を入力してください").max(100),
  status: z.enum(["ATTENDING", "DECLINED", "TENTATIVE"]),
  comment: z.string().max(255).optional(),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: eventId } = await params;
    const body = await req.json();
    const parsed = rsvpSchema.safeParse(body);
    if (!parsed.success) {
      return apiProblem({
        type: "https://api.example.com/errors/VALIDATION_ERROR",
        title: "Validation Error",
        status: 400,
        detail: "出欠データの形式が正しくありません。",
        errors: parsed.error.flatten().fieldErrors,
      });
    }

    const { name, status, comment } = parsed.data;

    // 端末照会用トークンの生成
    const plainToken = generateSecureToken("pt", 32);
    const hashedToken = hashToken(plainToken);

    const participant = await prisma.participant.create({
      data: {
        eventId,
        name,
        status,
        comment,
        responseTokenHash: hashedToken,
      },
    });

    const response = apiSuccess({
      participant_id: participant.id,
      event_id: participant.eventId,
      name: participant.name,
      status: participant.status,
      response_token: plainToken,
    }, 201);

    // 端末Cookieにトークンを書き込み
    response.cookies.set("rsvp_token", plainToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 30, // 30日間
    });

    return response;
  } catch (error) {
    console.error("RSVP Error:", error);
    return apiProblem({
      type: "https://api.example.com/errors/INTERNAL_ERROR",
      title: "Internal Server Error",
      status: 500,
      detail: "出欠の登録に失敗しました。",
    });
  }
}
```

#### 端末自動照会・変更 (`GET & PUT /api/v1/public/events/[id]/my-rsvp`)

```typescript
// src/app/api/v1/public/events/[id]/my-rsvp/route.ts
import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { hashToken } from "@/lib/crypto";
import { apiProblem, apiSuccess } from "@/lib/response";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: eventId } = await params;
  const plainToken = req.cookies.get("rsvp_token")?.value || req.headers.get("x-rsvp-token");

  if (!plainToken) {
    return apiSuccess({ is_registered: false, participant: null });
  }

  const hashedToken = hashToken(plainToken);
  const participant = await prisma.participant.findFirst({
    where: { eventId, responseTokenHash: hashedToken },
    select: { id: true, name: true, status: true, comment: true, updatedAt: true },
  });

  if (!participant) {
    return apiSuccess({ is_registered: false, participant: null });
  }

  return apiSuccess({ is_registered: true, participant });
}

const updateRsvpSchema = z.object({
  name: z.string().min(1).max(100),
  status: z.enum(["ATTENDING", "DECLINED", "TENTATIVE"]),
  comment: z.string().max(255).optional(),
});

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: eventId } = await params;
  const plainToken = req.cookies.get("rsvp_token")?.value || req.headers.get("x-rsvp-token");

  if (!plainToken) {
    return apiProblem({
      type: "https://api.example.com/errors/UNAUTHORIZED",
      title: "Unauthorized",
      status: 401,
      detail: "回答変更権限（端末トークン）が見つかりません。",
    });
  }

  const hashedToken = hashToken(plainToken);
  const body = await req.json();
  const parsed = updateRsvpSchema.safeParse(body);
  if (!parsed.success) {
    return apiProblem({
      type: "https://api.example.com/errors/VALIDATION_ERROR",
      title: "Validation Error",
      status: 400,
      detail: "更新データの形式が正しくありません。",
    });
  }

  const updated = await prisma.participant.updateMany({
    where: { eventId, responseTokenHash: hashedToken },
    data: {
      name: parsed.data.name,
      status: parsed.data.status,
      comment: parsed.data.comment,
    },
  });

  if (updated.count === 0) {
    return apiProblem({
      type: "https://api.example.com/errors/NOT_FOUND",
      title: "Not Found",
      status: 404,
      detail: "更新対象の回答データが存在しません。",
    });
  }

  return apiSuccess({ success: true, updated_at: new Date().toISOString() });
}
```

---

### 3.3. 幹事専用・参加者一覧取得API (`GET /api/v1/organizer/events/[id]/participants`)

参加者には一切レスポンスせず、幹事認可を厳格に要求する。

```typescript
// src/app/api/v1/organizer/events/[id]/participants/route.ts
import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { assertOrganizer } from "@/lib/guards";
import { apiProblem, apiSuccess } from "@/lib/response";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: eventId } = await params;

    // 幹事認可ガードの実行
    await assertOrganizer(req, eventId);

    const participants = await prisma.participant.findMany({
      where: { eventId },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        name: true,
        status: true,
        comment: true,
        createdAt: true,
        userId: true,
      },
    });

    return apiSuccess({
      event_id: eventId,
      total_count: participants.length,
      participants: participants.map((p) => ({
        id: p.id,
        name: p.name,
        status: p.status,
        comment: p.comment,
        is_registered_user: p.userId !== null,
        created_at: p.createdAt.toISOString(),
      })),
    });
  } catch (error: any) {
    if (error.message === "FORBIDDEN_NOT_ORGANIZER") {
      return apiProblem({
        type: "https://api.example.com/errors/FORBIDDEN",
        title: "Forbidden",
        status: 403,
        detail: "このイベントの参加者一覧を閲覧する権限がありません。",
      });
    }

    return apiProblem({
      type: "https://api.example.com/errors/INTERNAL_ERROR",
      title: "Internal Error",
      status: 500,
      detail: "参加者データの取得に失敗しました。",
    });
  }
}
```

---

### 3.4. 排他リースロック制御API

#### ロック取得・ハートビート・解放 (`src/app/api/v1/organizer/events/[id]/lock/route.ts`)

```typescript
import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { assertOrganizer } from "@/lib/guards";
import { generateSecureToken } from "@/lib/crypto";
import { apiProblem, apiSuccess } from "@/lib/response";

const LEASE_DURATION_SECONDS = 180; // 3分TTL

// 1. ロック獲得試行 (POST)
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: eventId } = await params;
    const auth = await assertOrganizer(req, eventId);
    const body = await req.json().catch(() => ({}));
    const holderName = body.holder_name || "共同幹事";
    const newLockToken = generateSecureToken("lk", 32);

    const now = new Date();
    const expiresAt = new Date(now.getTime() + LEASE_DURATION_SECONDS * 1000);

    // PostgreSQL アトミックUPSERT: 期限切れ時のみ上書き
    const result = await prisma.$executeRaw`
      INSERT INTO edit_locks (event_id, locked_by_user_id, locked_by_token, holder_name, locked_at, expires_at)
      VALUES (${eventId}::uuid, ${auth.userId ? auth.userId : null}::uuid, ${newLockToken}, ${holderName}, ${now}, ${expiresAt})
      ON CONFLICT (event_id) DO UPDATE
      SET
        locked_by_user_id = EXCLUDED.locked_by_user_id,
        locked_by_token = EXCLUDED.locked_by_token,
        holder_name = EXCLUDED.holder_name,
        locked_at = ${now},
        expires_at = ${expiresAt}
      WHERE edit_locks.expires_at <= ${now};
    `;

    if (result === 1) {
      return apiSuccess({
        locked: true,
        lock_token: newLockToken,
        expires_at: expiresAt.toISOString(),
        ttl_seconds: LEASE_DURATION_SECONDS,
      });
    }

    // 他者が有効なロックを保持中
    const currentLock = await prisma.editLock.findUnique({ where: { eventId } });
    const remainingSeconds = currentLock
      ? Math.max(0, Math.floor((currentLock.expiresAt.getTime() - now.getTime()) / 1000))
      : 0;

    return apiProblem({
      type: "https://api.example.com/errors/CONFLICT_LOCK",
      title: "Edit Lock Conflict",
      status: 409,
      detail: "他の幹事が編集中です。",
      errors: {
        holder_name: currentLock?.holderName || "他の幹事",
        expires_at: currentLock?.expiresAt.toISOString(),
        remaining_seconds: remainingSeconds,
        can_takeover: true,
      },
    });
  } catch (error: any) {
    return apiProblem({
      type: "https://api.example.com/errors/LOCK_ERROR",
      title: "Lock Acquisition Failed",
      status: error.message === "FORBIDDEN_NOT_ORGANIZER" ? 403 : 500,
      detail: error.message,
    });
  }
}

// 2. ハートビート延長 (PUT)
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: eventId } = await params;
    await assertOrganizer(req, eventId);
    const body = await req.json();
    const { lock_token } = body;

    if (!lock_token) {
      return apiProblem({
        type: "https://api.example.com/errors/BAD_REQUEST",
        title: "Bad Request",
        status: 400,
        detail: "lock_token が指定されていません。",
      });
    }

    const now = new Date();
    const newExpiresAt = new Date(now.getTime() + LEASE_DURATION_SECONDS * 1000);

    const updated = await prisma.editLock.updateMany({
      where: {
        eventId,
        lockedByToken: lock_token,
        expiresAt: { gt: now },
      },
      data: { expiresAt: newExpiresAt },
    });

    if (updated.count === 0) {
      return apiProblem({
        type: "https://api.example.com/errors/LOCK_EXPIRED",
        title: "Lock Expired",
        status: 409,
        detail: "ロックが失効したか、他幹事によって引き継がれました。",
      });
    }

    return apiSuccess({
      extended: true,
      expires_at: newExpiresAt.toISOString(),
      ttl_seconds: LEASE_DURATION_SECONDS,
    });
  } catch (error: any) {
    return apiProblem({
      type: "https://api.example.com/errors/HEARTBEAT_ERROR",
      title: "Heartbeat Failed",
      status: 500,
      detail: error.message,
    });
  }
}

// 3. ロック明示解放 (DELETE)
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: eventId } = await params;
    const lockToken = req.headers.get("x-lock-token");

    if (lockToken) {
      await prisma.editLock.deleteMany({
        where: { eventId, lockedByToken: lockToken },
      });
    }

    return new Response(null, { status: 204 });
  } catch (error: any) {
    return apiProblem({
      type: "https://api.example.com/errors/RELEASE_ERROR",
      title: "Lock Release Failed",
      status: 500,
      detail: error.message,
    });
  }
}
```

#### ロック強制引き継ぎ (`POST /api/v1/organizer/events/[id]/lock/takeover`)

```typescript
// src/app/api/v1/organizer/events/[id]/lock/takeover/route.ts
import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { assertOrganizer } from "@/lib/guards";
import { generateSecureToken } from "@/lib/crypto";
import { apiProblem, apiSuccess } from "@/lib/response";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: eventId } = await params;
    const auth = await assertOrganizer(req, eventId);
    const body = await req.json().catch(() => ({}));
    const holderName = body.holder_name || "共同幹事（引き継ぎ）";

    const newLockToken = generateSecureToken("lk", 32);
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 180 * 1000);

    // 既存ロックの状態を無視して無条件上書き
    await prisma.editLock.upsert({
      where: { eventId },
      create: {
        eventId,
        lockedByUserId: auth.userId || null,
        lockedByToken: newLockToken,
        holderName,
        lockedAt: now,
        expiresAt,
      },
      update: {
        lockedByUserId: auth.userId || null,
        lockedByToken: newLockToken,
        holderName,
        lockedAt: now,
        expiresAt,
      },
    });

    return apiSuccess({
      locked: true,
      lock_token: newLockToken,
      expires_at: expiresAt.toISOString(),
      ttl_seconds: 180,
      message: "編集権を強制的に引き継ぎました。",
    });
  } catch (error: any) {
    return apiProblem({
      type: "https://api.example.com/errors/TAKEOVER_ERROR",
      title: "Takeover Failed",
      status: 500,
      detail: error.message,
    });
  }
}
```

---

### 3.5. ロック保護付きイベント更新API (`PUT /api/v1/organizer/events/[id]`)

```typescript
// src/app/api/v1/organizer/events/[id]/route.ts
import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { assertOrganizer, assertLockHolder } from "@/lib/guards";
import { apiProblem, apiSuccess } from "@/lib/response";

const updateEventSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().optional(),
  event_start_at: z.string().datetime().optional().nullable(),
  location: z.string().max(255).optional().nullable(),
});

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: eventId } = await params;

    // 1. 幹事認可の検証
    await assertOrganizer(req, eventId);

    // 2. 排他ロック保持の検証
    await assertLockHolder(req, eventId);

    const body = await req.json();
    const parsed = updateEventSchema.safeParse(body);
    if (!parsed.success) {
      return apiProblem({
        type: "https://api.example.com/errors/VALIDATION_ERROR",
        title: "Validation Error",
        status: 400,
        detail: "イベント更新データが正しくありません。",
        errors: parsed.error.flatten().fieldErrors,
      });
    }

    const { title, description, event_start_at, location } = parsed.data;

    const updated = await prisma.event.update({
      where: { id: eventId },
      data: {
        title,
        description,
        eventStartAt: event_start_at ? new Date(event_start_at) : null,
        location,
      },
    });

    return apiSuccess({
      id: updated.id,
      updated_at: updated.updatedAt.toISOString(),
    });
  } catch (error: any) {
    if (error.message === "LOCK_TOKEN_REQUIRED" || error.message === "LOCK_INVALID_OR_EXPIRED") {
      return apiProblem({
        type: "https://api.example.com/errors/LOCK_CONFLICT",
        title: "Lock Required",
        status: 423, // Locked
        detail: "有効な編集ロックを保持していません。再度編集画面に入り直してください。",
      });
    }

    return apiProblem({
      type: "https://api.example.com/errors/INTERNAL_ERROR",
      title: "Internal Error",
      status: 500,
      detail: error.message,
    });
  }
}
```

---

### 3.6. 会員マイページ・アカウント統合（Hydration）＆ワンクリック複製API

#### アカウント統合 (`POST /api/v1/member/hydrate`)

```typescript
// src/app/api/v1/member/hydrate/route.ts
import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { hashToken } from "@/lib/crypto";
import { apiProblem, apiSuccess } from "@/lib/response";

const hydrateSchema = z.object({
  response_tokens: z.array(z.string()).default([]),
  guest_organizer_tokens: z.array(z.string()).default([]),
});

export async function POST(req: NextRequest) {
  try {
    // 認証済み会員ユーザーの特定（JWT等）
    const dummyUser = await prisma.user.findFirst();
    if (!dummyUser) {
      return apiProblem({
        type: "https://api.example.com/errors/UNAUTHORIZED",
        title: "Unauthorized",
        status: 401,
        detail: "ログインが必要です。",
      });
    }
    const currentUserId = dummyUser.id;

    const body = await req.json();
    const parsed = hydrateSchema.safeParse(body);
    if (!parsed.success) {
      return apiProblem({
        type: "https://api.example.com/errors/VALIDATION_ERROR",
        title: "Validation Error",
        status: 400,
        detail: "統合データ形式が不正です。",
      });
    }

    const { response_tokens, guest_organizer_tokens } = parsed.data;

    let hydratedParticipants = 0;
    let hydratedOrganized = 0;

    await prisma.$transaction(async (tx) => {
      // 1. 参加レコードの紐付け
      if (response_tokens.length > 0) {
        const hashedRsvpTokens = response_tokens.map(hashToken);
        const res = await tx.participant.updateMany({
          where: {
            responseTokenHash: { in: hashedRsvpTokens },
            userId: null,
          },
          data: { userId: currentUserId },
        });
        hydratedParticipants = res.count;
      }

      // 2. ゲスト幹事レコードの昇格
      if (guest_organizer_tokens.length > 0) {
        const hashedOrganizerTokens = guest_organizer_tokens.map(hashToken);
        const targetEvents = await tx.event.findMany({
          where: { guestOrganizerTokenHash: { in: hashedOrganizerTokens } },
          select: { id: true, guestOrganizerTokenHash: true },
        });

        for (const ev of targetEvents) {
          await tx.eventOrganizer.upsert({
            where: {
              eventId_userId: { eventId: ev.id, userId: currentUserId },
            },
            create: { eventId: ev.id, userId: currentUserId, role: "OWNER" },
            update: {},
          });

          // ゲストトークンを破棄
          await tx.event.update({
            where: { id: ev.id },
            data: { guestOrganizerTokenHash: null },
          });
          hydratedOrganized++;
        }
      }
    });

    return apiSuccess({
      hydrated_participations_count: hydratedParticipants,
      hydrated_organized_events_count: hydratedOrganized,
      message: "端末データの会員統合が完了しました。",
    });
  } catch (error: any) {
    return apiProblem({
      type: "https://api.example.com/errors/HYDRATION_ERROR",
      title: "Hydration Error",
      status: 500,
      detail: error.message,
    });
  }
}
```

#### イベントワンクリック複製 (`POST /api/v1/member/organized-events/[id]/clone`)

```typescript
// src/app/api/v1/member/organized-events/[id]/clone/route.ts
import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { assertOrganizer } from "@/lib/guards";
import { apiProblem, apiSuccess } from "@/lib/response";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: sourceEventId } = await params;
    const auth = await assertOrganizer(req, sourceEventId);

    if (!auth.userId) {
      return apiProblem({
        type: "https://api.example.com/errors/UNAUTHORIZED",
        title: "Unauthorized",
        status: 401,
        detail: "イベントの複製には会員登録・ログインが必要です。",
      });
    }

    const sourceEvent = await prisma.event.findUnique({
      where: { id: sourceEventId },
    });

    if (!sourceEvent) {
      return apiProblem({
        type: "https://api.example.com/errors/NOT_FOUND",
        title: "Not Found",
        status: 404,
        detail: "コピー元イベントが見つかりません。",
      });
    }

    // 複製トランザクション（参加者・ロック・招待コードは引き継がない）
    const newEvent = await prisma.$transaction(async (tx) => {
      const created = await tx.event.create({
        data: {
          title: `${sourceEvent.title} のコピー`,
          description: sourceEvent.description,
          location: sourceEvent.location,
          eventStartAt: null, // 日時は未設定
          organizers: {
            create: {
              userId: auth.userId!,
              role: "OWNER",
            },
          },
        },
      });
      return created;
    });

    return apiSuccess({
      new_event_id: newEvent.id,
      title: newEvent.title,
      description: newEvent.description,
      location: newEvent.location,
      event_start_at: null,
      message: "イベントを複製しました。日時を設定して公開してください。",
    }, 201);
  } catch (error: any) {
    return apiProblem({
      type: "https://api.example.com/errors/CLONE_ERROR",
      title: "Clone Error",
      status: 500,
      detail: error.message,
    });
  }
}
```