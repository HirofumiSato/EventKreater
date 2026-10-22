# 認証の試行回数を緩和し、上限と残り回数を必ず画面に表示する

> 起票済み: [#25](https://github.com/HirofumiSato/EventKreater/issues/25)。このファイルは設計の記録として残す。

## 背景

認証まわりの試行回数が厳しすぎる。とくに SMS と電話番号の確認コード送信、確認メールの再送が **1 時間に 3 回**で、SMS が届かない・番号を打ち間違える・機種変更中で旧端末が手元にない、といった普通の状況で詰まる。3 回は「攻撃を止める」より先に「正規の利用者を止める」水準になっている。

さらに、上限に当たったときの案内が不十分である。パスワードログイン・各種送信・管理者ログインは、上限に達するまで回数を画面に出さず、超えたときも「試行回数が多すぎます。しばらく待ってから再度お試しください。」とだけ返す。利用者は、何回まで許されていて、あと何分待てばよいのかが分からない。ログイン確認番号の入力だけが例外で、`10回間違えると、アカウントが15分間ロックされます。` と事前に出している。

**回数に上限を設ける操作は、必ず画面上で上限・残り回数・再試行可能時刻を示す**、を規則にする。

## 現状と根拠

### 上限の全一覧

| # | 対象 | バケット | 現在の上限 | 画面表示 |
| :-- | :--- | :--- | :--- | :--- |
| 1 | パスワードログイン（メール単位） | `login:email:<email>` | 5回 / 15分 | なし |
| 2 | パスワードログイン（IP単位） | `login:ip:<ip>` | 20回 / 15分 | なし |
| 3 | 管理者ログイン（メール単位） | `admin-login:email:<email>` | 5回 / 15分 | なし |
| 4 | 管理者ログイン（IP単位） | `admin-login:ip:<ip>` | 20回 / 15分 | なし |
| 5 | 会員登録（IP単位） | `register:ip:<ip>` | 5回 / 1時間 | なし |
| 6 | ログイン確認番号のSMS送信（会員単位） | `login-2fa:sms:user:<id>` | **3回 / 1時間** | なし |
| 7 | ログイン確認番号のSMS送信（IP単位） | `login-2fa:sms:ip:<ip>` | 8回 / 1時間 | なし |
| 8 | ログイン確認番号のメール送信（会員単位） | `login-2fa:email:user:<id>` | 5回 / 1時間 | なし |
| 9 | ログイン確認番号のメール送信（IP単位） | `login-2fa:email:ip:<ip>` | 10回 / 1時間 | なし |
| 10 | ログイン確認番号の入力ミス | `login-2fa:fail:user:<id>` | 10回で15分ロック | あり（`LoginChallengeForm`） |
| 11 | ログイン確認番号の照合（IP単位） | `login-2fa:confirm:ip:<ip>` | 20回 / 1時間 | なし |
| 12 | 確認メールの再送（メール単位） | `verify:email:<email>` | **3回 / 1時間** | なし |
| 13 | 確認メールの再送（IP単位） | `verify:ip:<ip>` | 10回 / 1時間 | なし |
| 14 | 確認リンクの照合（IP単位） | `verify-token:ip:<ip>` | 10回 / 1時間 | なし |
| 15 | 電話番号の確認コード送信（番号単位） | `phone:start:number:<E.164>` | **3回 / 1時間** | なし |
| 16 | 電話番号の確認コード送信（IP単位） | `phone:start:ip:<ip>` | 8回 / 1時間 | なし |
| 17 | 電話番号変更のコード送信（番号単位） | `phone:change:number:<E.164>` | **3回 / 1時間** | なし |
| 18 | 電話番号変更のコード送信（IP単位） | `phone:change:ip:<ip>` | 8回 / 1時間 | なし |
| 19 | 電話番号の確認コード入力ミス（コード単位） | `phone_verification_codes.attempts` | 5回でコード無効 | なし |
| 20 | 電話番号の確認コード照合（IP単位） | `phone:confirm:ip:<ip>` / `phone:change:confirm:ip:<ip>` | 20回 / 1時間 | なし |

根拠:

- `src/modules/auth/lib/rate-limit.ts:16-25` — `assertWithinAttemptLimit` は 429 と定型文だけを返し、残り回数も解除時刻も持たない。
- `src/app/api/v1/auth/local/route.ts:64-65` — ログインは 5回/15分（メール）と 20回/15分（IP）。`:37` が登録 5回/1時間。
- `src/app/api/v1/admin/session/route.ts:31-32` — 管理者ログイン 5回/15分（メール）と 20回/15分（IP）。
- `src/modules/auth/lib/login-challenge.ts:300-308` — SMS 3回/1時間、メール 5回/1時間。`:408` が照合 IP 20回/1時間。
- `src/modules/auth/lib/phone.ts:107-108,182-183` — 電話番号への送信 3回/1時間（番号）、8回/1時間（IP）。`:9` の `MAX_ATTEMPTS = 5` がコード入力ミスの上限。
- `src/app/api/v1/auth/verification/route.ts:21-22` — 確認メール再送 3回/1時間（メール）、10回/1時間（IP）。
- `src/app/api/v1/auth/verify/route.ts:20` — 確認リンク照合 10回/1時間（IP）。
- `src/modules/auth/components/LoginChallengeForm.tsx:217` — ログイン確認番号だけが上限を事前表示している。

### 画面表示の現状

| 画面 | ファイル | 上限の表示 |
| :--- | :--- | :--- |
| 主催者・参加者の登録 / ログイン | `src/modules/auth/components/AuthEntryScreen.tsx:96-139` | なし。`readProblem` の `detail` だけ |
| ログイン確認番号 | `src/modules/auth/components/LoginChallengeForm.tsx` | あり（入力ミス 10 回と 15 分ロック） |
| 電話番号の確認 | `src/modules/auth/components/AuthEntryScreen.tsx:270-410` | なし。コード入力ミスの残りも出ない |
| 管理者ログイン | `src/app/console/login/page.tsx:36` | なし |
| アカウント設定（メール・電話・パスワード・退会） | `src/modules/account/components/*Panel.tsx` | なし |
| 確認メールの再送 | `src/modules/auth/components/AuthEntryScreen.tsx:141-159` | なし |
| 確認リンクの照合 | `src/app/auth/verify/page.tsx:29` | なし |

`src/lib/problem.ts:29-31` の `problemMessage` は `detail` を返すだけで、上限の情報は捨てている。各画面が個別に文言を組み立てているため、上限を足すたびに表示漏れが起きる構造になっている。

### 既存の副作用

- `src/app/api/v1/auth/local/route.ts:64-70` は、ログイン成功時に `login:email:<email>` を消していない。4 回間違えたあとに正しくログインできても失敗回数が残り、同じ 15 分の窓で 1 回間違えるだけで 429 になる。管理者ログインも同じ。
- `src/modules/auth/lib/phone.ts:219,253` は `attempts >= MAX_ATTEMPTS` で黙って `INVALID_CODE` を返す。コードが無効になったことも、あと何回かも分からない。

## 今回の決定

| 論点 | 決定 |
| :--- | :--- |
| 数え方の基準 | 照合系（パスワード・コード）は **15分に10回**、送信系（SMS・メール・確認コード）は **1時間に5回** |
| 「3回」の扱い | 全廃する。SMS 送信・電話番号への送信・確認メール再送を 5回/1時間にする |
| IP 側の上限 | 会員・メール単位の 2 倍（照合系 40回/15分、送信系 10回/1時間）。分散送信はこちらで受ける |
| 6桁コードの入力ミス | 1 コードあたり 10 回。使い切ったらコードを無効にし、再送を促す（`error: "CODE_EXHAUSTED"`） |
| 表示の方式 | 常時の事前表示はしない。**失敗した時点で、上限・あと何回できるか・再試行可能時刻を必ず返して画面に出す**（429 だけでなく 400 / 401 の失敗応答にも載せる） |
| 表示の実装 | `problemMessage` が上限の情報を自動で文末に足す。各画面が個別に文言を持たない |
| 上限の一元化 | `src/modules/auth/lib/rate-limits.ts` に集約し、`label` を型で必須にする。表示文言を持たない上限を追加できないようにする |
| 環境変数 | 既定値を持たせ、env で上書きできる。`NEXT_PUBLIC_` は付けない（サーバ専用） |
| 成功時のリセット | パスワード照合に成功したら、メール単位の失敗カウンタを消す。IP 単位は消さない |
| 既存カウンタ | バケット名は変えない。改定前に積まれた行も新しい上限に対してそのまま数える |
| DB 変更 | なし（`auth_attempts` のスキーマはそのまま） |

## ゴール

1. 正規の利用者が、SMS の届かない状況や入力ミスで 1 時間締め出されない。
2. 上限のある操作では、失敗のたびに「何回までか」「あと何回か」「いつ再試行できるか」が画面に出る。
3. 上限値が 1 か所に集約され、追加時に表示文言の抜けが起きない。
4. 開発環境では env で上限を緩められる。
5. ログイン成功後に失敗回数が残らない。

## スコープ外

- チラシ生成・アップロードの回数制限（クォータの別概念。issue #4 で扱う）
- CAPTCHA、IP レピュテーション、WAF
- 管理コンソールから上限値を変更する仕組み（DB 保存）
- ロック方式そのものの変更（15 分固定を env で変えられるようにするだけ）
- 上限に達したときのメール通知・プッシュ通知
- パスワードの使い回し検出など、認証方式そのものの変更

## 実装方針

### 1. 上限を 1 か所に集約する

`src/modules/auth/lib/rate-limits.ts` を新設する。

```ts
const MINUTE = 60_000;

/** 正の整数だけを受け付ける。未設定・0・負数・小数・文字列は既定値へ落とす。 */
export function parsePositiveInt(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw.trim() === "") return fallback;
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

export interface RateLimitRule {
  /** auth_attempts.bucket の接頭辞。 */
  keyPrefix: string;
  /** 画面と detail に出す日本語の対象名。空にできない。 */
  label: string;
  limit: number;
  windowMs: number;
}

export interface RateLimitRules {
  loginEmail: RateLimitRule;
  loginIp: RateLimitRule;
  adminLoginEmail: RateLimitRule;
  adminLoginIp: RateLimitRule;
  registerIp: RateLimitRule;
  loginSmsUser: RateLimitRule;
  loginSmsIp: RateLimitRule;
  loginEmailChallengeUser: RateLimitRule;
  loginEmailChallengeIp: RateLimitRule;
  loginConfirmIp: RateLimitRule;
  verifyEmail: RateLimitRule;
  verifyIp: RateLimitRule;
  verifyTokenIp: RateLimitRule;
  phoneStartNumber: RateLimitRule;
  phoneStartIp: RateLimitRule;
  phoneChangeNumber: RateLimitRule;
  phoneChangeIp: RateLimitRule;
  phoneConfirmIp: RateLimitRule;
  phoneChangeConfirmIp: RateLimitRule;
}

export function createRules(env: NodeJS.ProcessEnv): RateLimitRules {
  const attemptLimit = parsePositiveInt(env.AUTH_ATTEMPT_LIMIT, 10);
  const attemptIpLimit = parsePositiveInt(env.AUTH_ATTEMPT_IP_LIMIT, 40);
  const attemptWindowMs = parsePositiveInt(env.AUTH_ATTEMPT_WINDOW_MINUTES, 15) * MINUTE;
  const sendLimit = parsePositiveInt(env.AUTH_SEND_LIMIT, 5);
  const sendIpLimit = parsePositiveInt(env.AUTH_SEND_IP_LIMIT, 10);
  const registerIpLimit = parsePositiveInt(env.AUTH_REGISTER_IP_LIMIT, 5);
  const confirmIpLimit = parsePositiveInt(env.AUTH_CONFIRM_IP_LIMIT, 20);
  const hour = 60 * MINUTE;

  return {
    loginEmail: { keyPrefix: "login:email:", label: "このメールアドレスのログイン", limit: attemptLimit, windowMs: attemptWindowMs },
    loginIp: { keyPrefix: "login:ip:", label: "この接続からのログイン", limit: attemptIpLimit, windowMs: attemptWindowMs },
    adminLoginEmail: { keyPrefix: "admin-login:email:", label: "このメールアドレスの管理者ログイン", limit: attemptLimit, windowMs: attemptWindowMs },
    adminLoginIp: { keyPrefix: "admin-login:ip:", label: "この接続からの管理者ログイン", limit: attemptIpLimit, windowMs: attemptWindowMs },
    registerIp: { keyPrefix: "register:ip:", label: "この接続からの会員登録", limit: registerIpLimit, windowMs: hour },
    loginSmsUser: { keyPrefix: "login-2fa:sms:user:", label: "確認番号のSMS送信", limit: sendLimit, windowMs: hour },
    loginSmsIp: { keyPrefix: "login-2fa:sms:ip:", label: "この接続からの確認番号のSMS送信", limit: sendIpLimit, windowMs: hour },
    loginEmailChallengeUser: { keyPrefix: "login-2fa:email:user:", label: "確認番号のメール送信", limit: sendLimit, windowMs: hour },
    loginEmailChallengeIp: { keyPrefix: "login-2fa:email:ip:", label: "この接続からの確認番号のメール送信", limit: sendIpLimit, windowMs: hour },
    loginConfirmIp: { keyPrefix: "login-2fa:confirm:ip:", label: "確認番号の照合", limit: confirmIpLimit, windowMs: hour },
    verifyEmail: { keyPrefix: "verify:email:", label: "確認メールの再送", limit: sendLimit, windowMs: hour },
    verifyIp: { keyPrefix: "verify:ip:", label: "この接続からの確認メールの再送", limit: sendIpLimit, windowMs: hour },
    verifyTokenIp: { keyPrefix: "verify-token:ip:", label: "確認リンクの照合", limit: sendIpLimit, windowMs: hour },
    phoneStartNumber: { keyPrefix: "phone:start:number:", label: "電話番号への確認コード送信", limit: sendLimit, windowMs: hour },
    phoneStartIp: { keyPrefix: "phone:start:ip:", label: "この接続からの確認コード送信", limit: sendIpLimit, windowMs: hour },
    phoneChangeNumber: { keyPrefix: "phone:change:number:", label: "新しい電話番号への確認コード送信", limit: sendLimit, windowMs: hour },
    phoneChangeIp: { keyPrefix: "phone:change:ip:", label: "この接続からの確認コード送信", limit: sendIpLimit, windowMs: hour },
    phoneConfirmIp: { keyPrefix: "phone:confirm:ip:", label: "確認コードの照合", limit: confirmIpLimit, windowMs: hour },
    phoneChangeConfirmIp: { keyPrefix: "phone:change:confirm:ip:", label: "確認コードの照合", limit: confirmIpLimit, windowMs: hour },
  };
}

export const RATE_LIMITS = createRules(process.env);

/** 1つの確認コードで許す入力ミス。 */
export const CODE_MAX_ATTEMPTS = parsePositiveInt(process.env.AUTH_CODE_MAX_ATTEMPTS, 10);
/** ログイン確認番号のロック時間。 */
export const LOCK_MS = parsePositiveInt(process.env.AUTH_LOCK_MINUTES, 15) * MINUTE;
/** 何回以上間違えたら残り回数を出すか。上限の値ではなく案内のしきい値。 */
export const WARN_AFTER_FAILURES = 3;

/** 「15分」「1時間」など、窓の長さの日本語表記。 */
export function windowLabel(windowMs: number): string {
  if (windowMs % (60 * MINUTE) === 0) return `${windowMs / (60 * MINUTE)}時間`;
  return `${Math.round(windowMs / MINUTE)}分`;
}
```

`label` を `RateLimitRule` の必須プロパティにすることで、上限を追加したら表示名も必ず書くことになる。

**実装時の確定事項（本文の擬似コードとの差）**

- 実装は `createRateLimits(env)` が `{ rules, codeMaxAttempts, lockMs }` を返し、`AUTH_RATE_LIMITS` として公開する。呼び出し側は `const { rules } = AUTH_RATE_LIMITS;` と書く。
- ログイン確認番号の入力ミスも `loginChallengeFailure`（`login-2fa:fail:user:`）として同じ表に置いた。上限に達したら 429 ではなくロック（423）にする点だけが他と違う。
- 窓の長さの日本語表記は画面側の `src/lib/problem.ts` に `windowText` として置いた。`rate-limits.ts` をクライアントから import すると `process.env` を読むため、表示の整形はクライアント側に閉じる。
- `WARN_AFTER_FAILURES` は従来どおり `login-challenge.ts` と `LoginChallengeForm.tsx` の 2 か所に置く。サーバは文面に、画面は黄色い案内のしきい値に使う。

改定する値:

| ルール | 変更前 | 変更後 |
| :--- | :--- | :--- |
| `loginEmail` | 5回 / 15分 | **10回 / 15分** |
| `loginIp` | 20回 / 15分 | **40回 / 15分** |
| `adminLoginEmail` | 5回 / 15分 | **10回 / 15分** |
| `adminLoginIp` | 20回 / 15分 | **40回 / 15分** |
| `registerIp` | 5回 / 1時間 | 変更なし |
| `loginSmsUser` | 3回 / 1時間 | **5回 / 1時間** |
| `loginSmsIp` | 8回 / 1時間 | **10回 / 1時間** |
| `loginEmailChallengeUser` | 5回 / 1時間 | 変更なし |
| `loginEmailChallengeIp` | 10回 / 1時間 | 変更なし |
| `loginConfirmIp` | 20回 / 1時間 | 変更なし |
| `verifyEmail` | 3回 / 1時間 | **5回 / 1時間** |
| `verifyIp` | 10回 / 1時間 | 変更なし |
| `verifyTokenIp` | 10回 / 1時間 | 変更なし |
| `phoneStartNumber` | 3回 / 1時間 | **5回 / 1時間** |
| `phoneStartIp` | 8回 / 1時間 | **10回 / 1時間** |
| `phoneChangeNumber` | 3回 / 1時間 | **5回 / 1時間** |
| `phoneChangeIp` | 8回 / 1時間 | **10回 / 1時間** |
| `phoneConfirmIp` / `phoneChangeConfirmIp` | 20回 / 1時間 | 変更なし |
| `CODE_MAX_ATTEMPTS` | 5回 | **10回** |
| `LOCK_MS` | 15分 | 変更なし（env 化のみ） |

### 2. `rate-limit.ts` をルール受け取りに変える

`src/modules/auth/lib/rate-limit.ts` を次の形にする。バケット名は今と同じ組み立てなので、既存の `auth_attempts` の行はそのまま数え続けられる。

```ts
export interface AttemptWindow {
  limit: number;
  windowSeconds: number;
  remainingAttempts: number;
  retryAfterSeconds: number;
  retryAt: string;
}

function bucketOf(rule: RateLimitRule, key: string): string {
  return `${rule.keyPrefix}${key}`;
}

/** 窓の中で何回使い、次にいつ空くか。 */
export async function attemptWindow(rule: RateLimitRule, key: string): Promise<AttemptWindow> {
  const now = Date.now();
  const since = new Date(now - rule.windowMs);
  const where = { bucket: bucketOf(rule, key), createdAt: { gte: since } };
  const [used, oldest] = await Promise.all([
    prisma.authAttempt.count({ where }),
    prisma.authAttempt.findFirst({ where, orderBy: { createdAt: "asc" }, select: { createdAt: true } }),
  ]);
  const resetAt = (oldest?.createdAt.getTime() ?? now) + rule.windowMs;
  return {
    limit: rule.limit,
    windowSeconds: Math.round(rule.windowMs / 1000),
    remainingAttempts: Math.max(0, rule.limit - used),
    retryAfterSeconds: Math.max(1, Math.ceil((resetAt - now) / 1000)),
    retryAt: new Date(resetAt).toISOString(),
  };
}

/** 応答本文に載せる上限の情報。429 と失敗応答で同じ形を使う。 */
export function limitExtras(rule: RateLimitRule, state: AttemptWindow): Record<string, unknown> {
  return {
    limitLabel: rule.label,
    attemptLimit: state.limit,
    remainingAttempts: state.remainingAttempts,
    windowSeconds: state.windowSeconds,
    retryAfterSeconds: state.retryAfterSeconds,
    retryAt: state.retryAt,
  };
}

export async function assertWithinAttemptLimit(rule: RateLimitRule, key: string): Promise<void> {
  const state = await attemptWindow(rule, key);
  if (state.remainingAttempts > 0) return;
  throw new ProblemDetailException({
    status: 429,
    title: "Too Many Requests",
    detail: `${rule.label}の回数が上限に達しました。`,
    error: "RATE_LIMITED",
    ...limitExtras(rule, state),
  });
}

export async function recordAuthAttempt(rule: RateLimitRule, key: string): Promise<void> {
  await prisma.authAttempt.create({ data: { bucket: bucketOf(rule, key) } });
  // 1 日より古い行を、書き込みのついでに掃除する（従来どおり）。
  const dayAgo = new Date(Date.now() - 24 * 60 * MINUTE);
  const recent = await prisma.authAttempt.count({
    where: { bucket: bucketOf(rule, key), createdAt: { gte: dayAgo } },
  });
  if (recent <= 1) {
    await prisma.authAttempt.deleteMany({ where: { createdAt: { lt: dayAgo } } });
  }
}
```

`clearAttempts` はバケット文字列を受け取る今の形を残す。成功時のリセット用に `clearRuleAttempts(rule, key)` を足した。

失敗応答（400 / 401）には、記録したあとの `attemptWindow` を載せる。

```ts
// 例: パスワード不一致
await recordAuthAttempt(RATE_LIMITS.loginEmail, email);
await recordAuthAttempt(RATE_LIMITS.loginIp, ip);
const emailState = await attemptWindow(RATE_LIMITS.loginEmail, email);
const ipState = await attemptWindow(RATE_LIMITS.loginIp, ip);
// 残りが少ないほうを出す。同じならメール単位を優先する。
const [rule, state] = emailState.remainingAttempts <= ipState.remainingAttempts
  ? [RATE_LIMITS.loginEmail, emailState] as const
  : [RATE_LIMITS.loginIp, ipState] as const;
throw new ProblemDetailException({
  status: 401,
  title: "Unauthorized",
  detail: LOGIN_FAILURE,
  ...limitExtras(rule, state),
});
```

`detail` は今の文面（メールの有無を明かさない）を変えない。回数の案内はクライアントが足す。

### 3. 環境変数

`.env.example` に追記する。すべてサーバ専用。

```dotenv
# 認証の試行回数。未設定なら既定値（コメント内の値）を使う。
# 15分あたり、メールアドレス単位の照合回数。
AUTH_ATTEMPT_LIMIT=10
# 15分あたり、IP単位の照合回数。
AUTH_ATTEMPT_IP_LIMIT=40
# 照合の窓（分）。
AUTH_ATTEMPT_WINDOW_MINUTES=15
# 1時間あたり、会員・電話番号あたりの送信回数。
AUTH_SEND_LIMIT=5
# 1時間あたり、IP単位の送信回数。
AUTH_SEND_IP_LIMIT=10
# 1時間あたり、IP単位の会員登録回数。
AUTH_REGISTER_IP_LIMIT=5
# 1時間あたり、IP単位の確認コード照合回数。
AUTH_CONFIRM_IP_LIMIT=20
# 1つの確認コードで許す入力ミス。
AUTH_CODE_MAX_ATTEMPTS=10
# ログイン確認番号のロック時間（分）。
AUTH_LOCK_MINUTES=15
```

実装上の注意:

- `process.env` はモジュール読み込み時に 1 回だけ読む。テストは `createRules(env)` を直接呼ぶ。
- 不正値（0・負数・小数・文字列）は既定値へ落とし、`NODE_ENV !== "production"` のときだけ `console.warn` を 1 回出す。
- 開発で上限を外したいときは `AUTH_ATTEMPT_LIMIT=1000` のように大きくする。`0` で無制限にはしない（0 は既定値へ落ちる）。

### 4. 応答の形

**429（上限到達）**

```json
{
  "type": "probs/rate-limit",
  "title": "Too Many Requests",
  "status": 429,
  "detail": "確認番号のSMS送信の回数が上限に達しました。",
  "error": "RATE_LIMITED",
  "limitLabel": "確認番号のSMS送信",
  "attemptLimit": 5,
  "remainingAttempts": 0,
  "windowSeconds": 3600,
  "retryAfterSeconds": 1830,
  "retryAt": "2026-10-22T08:42:00.000Z"
}
```

**401（パスワード不一致。上限にはまだ達していない）**

```json
{
  "type": "probs/unauthorized",
  "title": "Unauthorized",
  "status": 401,
  "detail": "メールアドレスまたはパスワードが正しくありません。",
  "limitLabel": "このメールアドレスのログイン",
  "attemptLimit": 10,
  "remainingAttempts": 7,
  "windowSeconds": 900,
  "retryAfterSeconds": 540,
  "retryAt": "2026-10-22T08:35:00.000Z"
}
```

**400（電話番号の確認コード不一致）**

```json
{
  "type": "probs/validation-error",
  "title": "Validation Error",
  "status": 400,
  "detail": "確認コードが正しくないか、期限が切れています。",
  "limitLabel": "確認コードの照合",
  "attemptLimit": 10,
  "remainingAttempts": 6,
  "windowSeconds": 600,
  "retryAfterSeconds": 420,
  "retryAt": "2026-10-22T08:20:00.000Z"
}
```

電話番号の確認コードは時間窓ではなく「1 つのコード」に対して数えるため、`windowSeconds` はコードの有効期限（10 分 = 600 秒）を渡し、`retryAt` はそのコードの `expiresAt` にする。「10分に10回までです。あと6回できます。」と読める。

コードを使い切ったときは別のエラーにする。再送は送信上限（5回/1時間）の範囲で許されるので、`windowSeconds` は付けない。付けると「もう一度送信してください」のあとに「HH:MMごろに再度お試しください」が足されて矛盾する。

```json
{
  "status": 400,
  "title": "Validation Error",
  "detail": "確認コードを10回間違えたため、このコードは無効になりました。もう一度送信してください。",
  "error": "CODE_EXHAUSTED",
  "limitLabel": "確認コードの照合",
  "attemptLimit": 10,
  "remainingAttempts": 0
}
```

**ログイン確認番号の照合（既存の形を維持）**

`src/modules/auth/lib/login-challenge.ts` の `invalidCode` は `remainingAttempts` / `attemptLimit` / `lockMinutes` を返す今の形のままにする。`windowSeconds` は付けない。付けると `LoginChallengeForm` の黄色い予告と `limitNotice` が二重に出るため。

### 5. 429 のヘッダ

`src/lib/http.ts:4-10` の `problemResponse` で、429 のときだけ標準ヘッダを足す。

```ts
const headers: Record<string, string> = { "Content-Type": "application/problem+json" };
const retryAfter = error.extras.retryAfterSeconds;
const retryAt = error.extras.retryAt;
const limit = error.extras.attemptLimit;
if (error.status === 429 && typeof retryAfter === "number") {
  headers["Retry-After"] = String(retryAfter);
  if (typeof limit === "number") {
    headers["X-RateLimit-Limit"] = String(limit);
    headers["X-RateLimit-Remaining"] = "0";
  }
  if (typeof retryAt === "string") {
    headers["X-RateLimit-Reset"] = String(Math.floor(Date.parse(retryAt) / 1000));
  }
}
return NextResponse.json(error.toBody(instance), { status: error.status, headers });
```

画面は本文の `retryAt` を使う。ヘッダは API 利用者と結合テスト用。

### 6. 画面表示

`src/lib/problem.ts` を拡張する。**各画面が個別に文言を組み立てない**のが要点で、`readProblem` を使っている画面は自動的に表示される。

```ts
export interface ProblemBody {
  // ...既存
  limitLabel?: string;
  windowSeconds?: number;
  retryAfterSeconds?: number;
  retryAt?: string;
}

function windowText(seconds: number): string {
  if (seconds % 3600 === 0) return `${seconds / 3600}時間`;
  return `${Math.round(seconds / 60)}分`;
}

function clockText(iso: string): string | null {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return null;
  return new Date(ms).toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" });
}

/** 上限の案内。上限の情報が無い応答と、アカウントロック（既存表示がある）では null。 */
export function limitNotice(body: ProblemBody): string | null {
  if (body.error === "ACCOUNT_LOCKED") return null;
  if (typeof body.attemptLimit !== "number" || typeof body.windowSeconds !== "number") return null;
  const window = windowText(body.windowSeconds);
  const label = body.limitLabel ?? "この操作";
  const remaining = body.remainingAttempts;
  if (typeof remaining === "number" && remaining > 0) {
    return `${label}は${window}に${body.attemptLimit}回までです。あと${remaining}回できます。`;
  }
  const clock = body.retryAt ? clockText(body.retryAt) : null;
  return clock
    ? `${label}は${window}に${body.attemptLimit}回までです。${clock}ごろに再度お試しください。`
    : `${label}は${window}に${body.attemptLimit}回までです。しばらく待ってから再度お試しください。`;
}

/** 本文の detail だけを返す。上限は別に描きたい画面が使う。 */
export function problemDetail(body: ProblemBody, fallback = "リクエストに失敗しました"): string {
  return body.detail || body.error || fallback;
}

export function problemMessage(body: ProblemBody, fallback = "リクエストに失敗しました"): string {
  const base = problemDetail(body, fallback);
  const notice = limitNotice(body);
  return notice ? `${base} ${notice}` : base;
}
```

表示例:

- パスワードを 3 回間違えた: `メールアドレスまたはパスワードが正しくありません。 このメールアドレスのログインは15分に10回までです。あと7回できます。`
- 上限に達した: `確認番号のSMS送信の回数が上限に達しました。 確認番号のSMS送信は1時間に5回までです。15:42ごろに再度お試しください。`
- 電話コードを間違えた: `確認コードが正しくないか、期限が切れています。 確認コードの照合は1時間に20回までです。あと6回できます。`

`LoginChallengeForm` だけは黄色い案内を別に描いているので、`describeProblem` を `problemDetail` + `limitNotice` に差し替えて二重表示を避ける。既存の `LOCK_WARNING_PATTERN` による重複除去は残す。

`limitNotice` が動くのは `windowSeconds` があるときだけ。ログイン確認番号の 400 は `windowSeconds` を返さないので、既存の「あと n 回でアカウントがロックされます。」だけが出る。

### 7. 呼び出し側の変更

| ファイル | 変更 |
| :--- | :--- |
| `src/app/api/v1/auth/local/route.ts` | `assertWithinAttemptLimit` / `recordAuthAttempt` をルール渡しに。401 に `limitExtras` を付ける。成功時にメール単位のカウンタを消す |
| `src/app/api/v1/admin/session/route.ts` | 同上（管理者用ルール） |
| `src/modules/auth/lib/login-challenge.ts` | `MAX_ATTEMPTS` / `LOCK_MS` を `rate-limits.ts` から取る。送信はルール渡しに。`issueChallenge` の 429 にラベルが付く |
| `src/modules/auth/lib/phone.ts` | `MAX_ATTEMPTS` を `CODE_MAX_ATTEMPTS` に。送信はルール渡しに。`invalidCode` を `invalidCode(state)` にして `limitLabel` / `attemptLimit` / `remainingAttempts` / `windowSeconds`（コード TTL）/ `retryAfterSeconds` / `retryAt`（`expiresAt`）を載せる。使い切ったら `CODE_EXHAUSTED` |
| `src/app/api/v1/auth/verification/route.ts` | ルール渡しに |
| `src/app/api/v1/auth/verify/route.ts` | ルール渡しに |
| `src/lib/http.ts` | 429 のヘッダ |
| `.env.example` | 9 変数 |

変更不要（`readProblem` 経由で自動的に表示される）:

- `src/app/console/login/page.tsx`
- `src/modules/account/components/AccountInfoPanel.tsx`
- `src/modules/account/components/PhoneChangePanel.tsx`
- `src/modules/account/components/PasswordPanel.tsx`
- `src/modules/account/components/WithdrawPanel.tsx`
- `src/app/auth/verify/page.tsx`

### 8. 電話番号確認の再送導線

`PhoneScreen`（`src/modules/auth/components/AuthEntryScreen.tsx:270-410`）は、`sent === true` のあと送信し直す手段が無い。コードを使い切ったときに詰むので、次を足す。

- `sent` のとき「確認コードを送り直す」ボタンを出す。押すと `start` を呼ぶ（`phone` は入力済みの値）。
- `CODE_EXHAUSTED` を受けたら、エラー文に加えて同じボタンを強調表示する。
- 送信し直したら `code` を空にし、`notice` を「確認コードを送り直しました。」にする。
- 残り送信回数は `limitNotice` が出す。

### 9. 成功時に数え直す

`src/app/api/v1/auth/local/route.ts` のログイン成功時（`passwordOk` が真）と、`src/app/api/v1/admin/session/route.ts` の管理者ログイン成功時に、メール単位のバケットを消す。

```ts
await clearAttempts(bucketOf(RATE_LIMITS.loginEmail, email));
```

IP 単位は消さない。同じ IP を共有する別の利用者の失敗を、1 人の成功で帳消しにしないため。

### 10. テスト

**単体 `tests/unit/auth-rate-limits.test.ts`**

- `parsePositiveInt`: 未設定・空文字・`"0"`、`"-1"`、`"1.5"`、`"abc"` は既定値、`"7"` は 7。
- `createRateLimits`: env を渡すと `limit` と `windowMs` が変わる。全ルールの `label` が空でなく、接頭辞が `:` で終わる。
- 窓の表記: `limitNotice` で 900 秒 → `15分`、3600 秒 → `1時間`、5400 秒 → `1時間30分` ではなく `90分` になることを確かめる。
- `limitNotice`: 残りあり / 残り 0 + `retryAt` / `windowSeconds` 無しで `null` / `ACCOUNT_LOCKED` で `null`。
- `problemMessage`: 上限があるときだけ文末に案内が付く。
- `problemResponse`: 429 に `Retry-After` / `X-RateLimit-*` を付け、429 以外には付けない。

**結合 `tests/integration/auth-attempts.test.ts`**（`TEST_DATABASE_URL` があるときだけ実行。既存の `describeDb` 方式に合わせる）

- `attemptWindow` が窓の外の行を数えない。`retryAfterSeconds` が窓の長さ以下になる。
- `assertWithinAttemptLimit` が上限で 429 を投げ、`limitExtras` の 6 項目が揃う。
- 上限の手前では投げない。バケットが違えば互いに影響しない。
- 成功でバケットを消すと残りが戻る。`tighterLimit` が厳しいほうを選ぶ。
- env の上書きが窓の長さにも効く。
- 電話番号の確認コードを上限まで間違えると `error: "CODE_EXHAUSTED"` になり、そのあと正しいコードでも通らない。
- 正しいコードは通り、照合の残りは IP 単位で減る。
- 後始末: 使ったバケットの `authAttempt` と、作った `phoneVerificationCode` / `user` を削除する。

**既存テスト**

- 上限値を直接書いているテストが無いことを確認する。あれば `AUTH_RATE_LIMITS.rules` 参照へ置き換える。

### 11. ドキュメント

| ファイル | 更新内容 |
| :--- | :--- |
| `docs/overall_system_requirements_common.md:633,635` | SMS 3→5回、電話番号 3→5回、確認メール再送 3→5回、ログイン 5→10回/15分、IP 20→40回/15分、コード入力ミス 5→10回。あわせて「上限のある操作は失敗時に上限・残り回数・再試行時刻を必ず表示する」を追記 |
| `docs/backend_api_implementation_spec.md:1737,1833,1837,1869,1881,1917,1923` | 数値の更新、429 / 400 / 401 の応答項目（`limitLabel` / `attemptLimit` / `remainingAttempts` / `windowSeconds` / `retryAfterSeconds` / `retryAt`）、`error: "RATE_LIMITED"` / `"CODE_EXHAUSTED"`、`Retry-After` ヘッダ |
| `docs/front_implementation_spec.md:1192-1198` | 受け入れ条件を追加（下記 FE-AUTH-08〜12） |
| `docs/DBschema.md:29,775` | ロック 10 回・15 分は据え置き。電話コードの入力ミスを 5→10 回に更新 |
| `docs/issues/auth-attempt-limits.md` | 本文書（設計の記録） |

追加する受け入れ条件:

| ID | 項目 | 手順 | 期待 |
| :--- | :--- | :--- | :--- |
| FE-AUTH-08 | ログイン失敗の残り回数 | パスワードを 1 回間違える | 赤い案内のあとに「このメールアドレスのログインは15分に10回までです。あと9回できます。」が出ること |
| FE-AUTH-09 | ログイン上限 | 10 回間違え、さらに送信する | 「…15分に10回までです。HH:MMごろに再度お試しください。」が出ること。時刻は `retryAt` のローカル時刻であること |
| FE-AUTH-10 | SMS 送信上限 | 確認番号を 5 回送り、6 回目を送る | 「確認番号のSMS送信は1時間に5回までです。HH:MMごろに…」が出ること |
| FE-AUTH-11 | 電話コードの使い切り | 確認コードを 10 回間違える | 「…このコードは無効になりました。もう一度送信してください。」と「確認コードを送り直す」ボタンが出ること |
| FE-AUTH-12 | 上限の二重表示なし | 確認番号を 3 回間違える | 黄色い予告が 1 つだけ出て、赤い案内に回数の文が混ざらないこと |

## 受け入れ条件

### 上限値

- [ ] パスワードログインはメールあたり 15 分に 10 回、IP あたり 15 分に 40 回
- [ ] 管理者ログインはメールあたり 15 分に 10 回、IP あたり 15 分に 40 回
- [ ] ログイン確認番号の SMS 送信は会員あたり 1 時間に 5 回、IP あたり 1 時間に 10 回
- [ ] ログイン確認番号のメール送信は会員あたり 1 時間に 5 回、IP あたり 1 時間に 10 回
- [ ] 電話番号の確認コード送信は番号あたり 1 時間に 5 回、IP あたり 1 時間に 10 回
- [ ] 確認メールの再送はメールあたり 1 時間に 5 回、IP あたり 1 時間に 10 回
- [ ] 電話番号の確認コード入力ミスは 1 コードあたり 10 回
- [ ] どの値も env で上書きでき、不正値は既定値に戻る

### 表示

- [ ] ログイン失敗のたびに、上限・あと何回できるか・再試行可能時刻が出る
- [ ] 429 のときに、同じ 3 つが出る（`retryAt` のローカル時刻）
- [ ] 電話番号確認のコードミスでも残り回数が出る
- [ ] コードを使い切ったら無効になったことと再送導線が出る
- [ ] 管理者ログイン・会員登録・確認メール再送・アカウント設定の各パネルでも同じように出る
- [ ] 同じ案内が赤と黄色で二重に出ない
- [ ] ログイン確認番号の既存の「10回間違えると、アカウントが15分間ロックされます。」が壊れない

### 副作用

- [ ] ログイン成功後に、メール単位の失敗回数が消える
- [ ] 成功しても IP 単位の回数は消えない
- [ ] 429 の応答に `Retry-After` と `X-RateLimit-*` が付く
- [ ] バケット名が変わっていないため、改定前の `auth_attempts` の行も数えられる

### テスト・ドキュメント

- [ ] `tests/unit/auth-rate-limits.test.ts` と `tests/integration/auth-attempts.test.ts` が通る
- [ ] `npm test` / lint / typecheck が通る
- [ ] 5 つのドキュメントの数値と受け入れ条件が実装と一致する

## セキュリティ上の判断

- パスワードは bcrypt cost 12（`src/modules/auth/lib/auth.ts:24-32`）で 1 回あたり数百ミリ秒かかる。10 回/15 分・40 回/15 分でも総当たりは現実的でない。ログインはさらに確認番号（2 段階目）が要る。
- 照合系を 10 回にしても、確認番号が 6 桁・10 分・10 回でロックされるため、突破確率は十分低い。
- 送信系は「被害者へのスパム」を防ぐ上限なので、番号あたりは 3→5 回に留める。IP 側を 10 回に上げるのは、同じ回線を共有する正規利用者の巻き添えを減らすため。
- IP 単位のカウンタを成功で消さないのは、共有 IP での巻き添え回避を攻撃者に利用させないため。
- `remainingAttempts` を返しても、メールアドレスの存在は明かさない（存在しないメールでも同じ形で数える）。

## 参考

- `src/modules/auth/lib/rate-limit.ts` — 現在の試行回数の実装
- `src/app/api/v1/auth/local/route.ts` — 登録・ログイン
- `src/app/api/v1/admin/session/route.ts` — 管理者ログイン
- `src/modules/auth/lib/login-challenge.ts` — 確認番号の発行・照合・ロック
- `src/modules/auth/lib/phone.ts` — 電話番号の確認
- `src/app/api/v1/auth/verification/route.ts` — 確認メールの再送
- `src/app/api/v1/auth/verify/route.ts` — 確認リンクの照合
- `src/lib/http.ts` — 問題詳細の応答
- `src/lib/problem.ts` — 画面側のエラー文言
- `src/modules/auth/components/LoginChallengeForm.tsx` — 確認番号の画面
- `src/modules/auth/components/AuthEntryScreen.tsx` — 登録・ログイン・電話番号確認
- `docs/overall_system_requirements_common.md` — 要件
- `docs/backend_api_implementation_spec.md` — API 仕様
- `docs/front_implementation_spec.md` — 画面の受け入れ条件
