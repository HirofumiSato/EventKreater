# 登録途中のパスワードを保存し、ログインフォームから登録を再開できるようにする

## 背景

1. **Chrome のパスワード生成と保存が効かない。** 登録フォームの名前欄とパスワード欄に `name` と `autocomplete` が無いため、Chrome が「新規パスワードの作成」と判定できず、生成サジェストを出さない。加えて送信が `preventDefault` と `fetch` で、画面遷移が起きない。Chrome はフォームの送信（遷移）を合図に保存を出すので、保存の合図も無い。同じリポジトリの `PasswordPanel.tsx` と `console/login/page.tsx` には正しく付いている。
2. **登録途中でパスワードが未保存のまま詰む。** パスワードは `signup_intents.password_hash` にだけ入り、`users` の行は電話番号の確認まで作られない。そのため `signup_intent` Cookie を失う・24 時間を過ぎる・別端末で確認メールを開く、のいずれかで `phone/start` が 401 で止まる。ログインも会員行が無いので同じく 401 になる。登録し直すと `beginSignupIntent` が同じメールアドレスの意向を消して作り直すため、前回の続きには戻れない。

## 現状と根拠

| 対象 | 現状 |
| :--- | :--- |
| `src/modules/auth/components/AuthEntryScreen.tsx` | 登録・ログインのフォームに `name` と `autocomplete` が無い。送信は `preventDefault` と `fetch` で、画面遷移しない |
| `src/modules/account/components/PasswordPanel.tsx`、`src/app/console/login/page.tsx` | `autocomplete` が付いている。保存の明示的な呼び出しは無い |
| `signup_intents` | パスワードは `password_hash` にだけ入る。`users` の行は電話番号の確認まで作らない |
| `SIGNUP_INTENT_MAX_AGE`（`src/modules/auth/lib/cookies.ts`） | 24 時間 |
| `POST /api/v1/auth/local` の登録 | 新規・登録済み・未確認の既存会員で同じ応答を返し、メールの有無を明かさない |
| `POST /api/v1/auth/phone/start`、`phone/confirm` | `signup_intent` Cookie の意向が無い・期限切れ・未確認だと 401。本文は `missingSubject()` が持つ |
| ログインの失敗回数 | メールアドレス単位 15 分に 10 回、IP 単位 15 分に 40 回（`src/modules/auth/lib/rate-limits.ts`） |

## 今回の決定

| 論点 | 決定 |
| :--- | :--- |
| 生成サジェスト | 名前欄は `name="name"` と `autocomplete="name"`、メール欄は `name="email"` と `username`、パスワード欄は `name="password"` と登録時 `new-password`・ログイン時 `current-password` を付ける |
| フォームの作り直し | `<form key={mode}>` にして、登録とログインで要素を作り直す。同じ要素の `autocomplete` を書き換えるだけでは、Chrome が新しい用途として解析し直さない |
| 保存の呼び出し | 新規 `password-credential.ts` の `savePasswordCredential()` が `navigator.credentials.store(new PasswordCredential(...))` を呼ぶ。`window.isSecureContext`、`window.PasswordCredential`、`navigator.credentials.store` を feature detect し、失敗は握りつぶす |
| 保存するタイミング | 送信が成功した直後（`res.ok` の直後）。登録は `verificationRequired` のとき、ログインは `challengeRequired` か `phoneVerified` のとき。パスワードが一致した経路だけで呼ぶ |
| 再開の引き当て | 退会していない会員に `passwordHash` が無いとき、`signup_intents` をメールアドレスの最新 1 件で引き、パスワードを照合する |
| 未確認の意向 | 一致したら `200 { verificationRequired: true, unverifiedEmail: true, detail }`。`verifyEmail` と `verifyIp` の上限を確かめて記録し、確認メールを再送する |
| 確認済み・電話未確認の意向 | 一致したら `200 { signupPending: true, next: "phone", audience }`。`signup_intent` Cookie を httpOnly・24 時間で付け直す |
| 一致しないとき | 従来どおり 401。会員や意向の有無は応答で明かさない |
| 期限切れの意向 | パスワードが一致したときだけ期限を 24 時間へ延ばす。`emailVerifiedAt` は保持し、未確認を確認済みにしない |
| 照合の時間 | `src/modules/auth/lib/auth.ts` の `passwordHashMatches` が、ハッシュが null でもダミーハッシュで同じだけ時間をかける |
| 画面の遷移 | `signupPending` なら `audience` に合わせた入口（`/auth/register` か `/participant/login`）の `?step=phone` へ進む。入口が変わるときは `next` を引き継がない |
| 未確認の表示 | `unverifiedEmail` なら、確認メールの再送ボタンを出す |
| 電話番号画面の行き止まり | `phone/start` の 401 で、朱の主操作を増やさず `text-link` の「続きから再開」を `${basePath}?mode=login` へ出す。`next` は引き継がない |
| 失敗回数 | パスワードが一致したらメールアドレス単位の失敗回数を消す。IP 単位は消さない |
| DB スキーマ | 変更しない。`signup_intents.password_hash` と `expires_at` をそのまま使う |

## 実装

### 1. 登録・ログインフォームの属性

`src/modules/auth/components/AuthEntryScreen.tsx`。名前欄は `name="name"`、メール欄は `name="email"` と `autoComplete="username"`、パスワード欄は `name="password"` と `autoComplete={mode === "register" ? "new-password" : "current-password"}` にした。フォームは `<form key={mode}>` にして、登録とログインを別の要素として作り直す。

### 2. パスワードの保存

新規 `src/modules/auth/lib/password-credential.ts`。

| 関数 | 役割 |
| :--- | :--- |
| `savePasswordCredential(input, container?)` | `PasswordCredential` を作り、`navigator.credentials.store()` へ渡す。保存を頼めたときだけ `true` |

`container` の既定は `window` と `navigator` をまとめた値で、テストでは差し替える。`isSecureContext` が真でない、`PasswordCredential` が無い、`store` が無い、のいずれかでは保存せず `false` を返す。`store` が失敗しても例外を投げず、登録とログインは止めない。`lib.dom.d.ts` に `PasswordCredential` が無いため、使う形だけを型として自前で定義した。

呼び出しは `submit()` の中、`res.ok` の直後で `setPassword("")` より前に行う。登録は `body.verificationRequired`、ログインは `body.challengeRequired` か `body.phoneVerified` を受けたときだけで、名前は登録のときだけ渡す。

### 3. 登録途中の再開（サーバー）

新規 `src/modules/auth/lib/signup-resume.ts`。

```ts
export type SignupResumeResult =
  | { kind: "none" }
  | { kind: "email_pending"; intent: { id; email; name; audience } }
  | { kind: "phone_pending"; intentId: string; audience: "ORGANIZER" | "PARTICIPANT" };

export async function resumeSignupIntent(input: {
  email: string;
  password: string;
  now?: Date;
}): Promise<SignupResumeResult>;
```

- 退会していない会員に `passwordHash` があるときは `none`。通常のパスワード照合に任せる。
- 会員と意向は並べて引き、会員にパスワードがあるとき・意向が無いときもダミーで 1 回照合する。どの経路でも bcrypt を 1 回だけにして、応答時間から有無を読ませない。
- `signup_intents` をメールアドレスの最新 1 件で引く。無ければ `none`。
- `passwordHashMatches` で照合し、不一致・`passwordHash` なしは `none`。
- 期限が過ぎていれば 24 時間へ延ばす（`updateMany` で期限だけを書き換える）。
- `emailVerifiedAt` が無ければ `email_pending`、あれば `phone_pending`。

`src/app/api/v1/auth/local/route.ts` のログイン分岐では、会員のパスワードが一致しなかったときにこれを呼ぶ。

- `email_pending`: `verifyEmail`（メールあたり 1 時間に 5 回）と `verifyIp`（IP あたり 1 時間に 10 回）の上限を確かめて記録し、`sendIntentVerification` で再送する。`clearRuleAttempts(loginEmail)` のあと、`verificationRequired`・`unverifiedEmail`・`detail` を返す。
- `phone_pending`: `clearRuleAttempts(loginEmail)` のあと、`signupPending`・`next: "phone"`・`audience` を返し、`writeCookie` で `signup_intent` を 24 時間で付ける。
- どちらでもないとき: `recordAuthAttempt` でメール単位と IP 単位を数え、従来の 401 `loginFailure()` を投げる。IP 単位の回数は成功でも消さない。

### 4. 登録途中の再開（画面）

`AuthEntryScreen.tsx` の `submit()`。

- 応答型に `signupPending`、`unverifiedEmail`、`audience` を足した。
- `signupPending` なら `body.audience` に合わせて `/auth/register?step=phone` か `/participant/login?step=phone` へ `router.push` する。入口が変わるときは `next` を付けない。
- `unverifiedEmail` なら `setUnverified(true)` で再送ボタンを出す。あわせて「確認メールを送信しました…」の案内を出し、パスワード欄を空にする。ログインのフォームのまま留まる（FE-AUTH-17）。
- それ以外の `verificationRequired`（新規登録と既登録メール）は `setSent(true)` で確認メールの案内を出し、パスワード欄を空にする。登録のフォームからログインのフォームへは切り替えない（FE-AUTH-01）。「確認メールを再送する」と「メールアドレスを直す」を出し、後者で `setSent(false)` にして登録のフォームへ戻す。
- mode を切り替えたときは、`sent`・`notice`・`error`・`unverified`・`adminConsoleRequired` を消す。前の応答の案内を持ち越さない。

### 5. 電話番号の確認画面

`PhoneScreen` の `request()`（`phone/start`）と `confirm()`（`phone/confirm`）が 401 を受けたら `subjectMissing` を立てる。主操作（朱）は増やさず、`${basePath}?mode=login` への `text-link`「続きから再開」を出す。`src/modules/auth/lib/phone.ts` の `missingSubject()` の本文は「登録の続きは、メールアドレスとパスワードで再開できます。」に変えた。

## テスト

テストは別の作業で追加した。件数は `docs/testing/scope.rst` が持つ。

- `tests/integration/signup-resume.test.ts`（`TEST_DATABASE_URL` があるときだけ）— 確認済みの意向はパスワード一致で `phone_pending`、未確認の意向は `email_pending` を返して会員行を作らない、期限切れの意向は期限だけ 24 時間へ延ばし `emailVerifiedAt` を保つ、不一致・意向なし・パスワードを持つ会員がいる・パスワードを持たない意向は `none`。
- `tests/unit/password-credential.test.ts` — 非セキュアコンテキストでは保存せず `false`、`PasswordCredential` が無ければ保存しない、`store` が失敗しても例外を投げず `false`、保存できたらメールアドレス・パスワード・名前を 1 回だけ渡す。
- `tests/components/auth-entry-screen.test.tsx` — 登録の成功は登録のフォームのまま確認メールの案内と再送を出し、ログインの見出し・送信ボタン・パスワード欄を出さない。確認パネルの見出しと API の案内を重ねない。未確認のままログインしたときはログインフォームのまま再送を出す。`メールアドレスを直す` で登録のフォームへ戻る。再送の成功は「確認メールを送り直しました。」だけを出し、本文を重ねない。
- 既存の `tests/integration/auth-attempts.test.ts` と `tests/unit/auth-mode.test.ts` が通ること。

## 受け入れ条件

- [x] `/auth/register` のパスワード欄に Chrome の「強力なパスワードを使用」が出る
- [x] 生成したパスワードで登録すると、送信の成功後に保存され、ログインのパスワード欄に自動入力される
- [x] `http://192.168.x.x` のような非セキュアなオリジンでも、保存を試みずに登録とログインが最後まで進む
- [x] メール確認だけを済ませて `signup_intent` Cookie を消し、ログインフォームで同じメールアドレスとパスワードを入れると `?step=phone` に戻る
- [x] そのまま電話番号の確認を終え、会員として着地できる
- [x] 未確認の意向なら、ログインで確認メールが再送され、再送ボタンが出る
- [x] パスワードが違うときは従来の 401 のままで、会員かどうかも登録途中かどうかも分からない
- [x] 電話番号の確認画面が 401 のとき、「続きから再開」からログインへ進める
- [x] 電話番号の確認画面に朱の主操作が 2 つ出ない
- [x] 期限切れの意向でも、パスワードが一致すれば続きへ戻れる

## スコープ外

- 管理コンソールのログイン（`src/app/console/login/page.tsx`）への `navigator.credentials.store()` の追加。`autocomplete` は既にある。
- フォームの POST と 302 への作り替え。
- 別のメールアドレスで既存会員の電話番号を使ったときの `PHONE_CONFLICT` の扱い。現状は再試行でき、恒久的な行き止まりではない。
- Google で開始した意向の再開。パスワードが無いため、Google からやり直す。
- モックの撮り直し。実装 PR では回さず、`npm run mock:catchup` を別の PR で回す（[ui-review/mock-sync.md](../ui-review/mock-sync.md)）。

## セキュリティ上の判断

- 応答の形は「会員がいる / いない」「意向がある / ない」で変えない。`signupPending` と `unverifiedEmail` は、意向のパスワードが一致した本人にだけ返る。一致しないときは従来の 401 と同じ本文と残り回数にする。
- 照合は `passwordHashMatches` を通し、ハッシュが無い意向でもダミーハッシュで同じだけ時間をかける。応答時間から意向の有無を読ませない。
- 意向の期限は、パスワード一致という本人確認のあとだけ延ばす。メール確認済みの事実は保持するが、未確認を確認済みにはしない。
- 付け直す `signup_intent` Cookie は httpOnly・SameSite=Lax・path `/` で、HTTPS では `secure`。有効期限は `SIGNUP_INTENT_MAX_AGE` の 24 時間。
- パスワードが一致しても消すのはメールアドレス単位の失敗回数だけにした。IP 単位を消すと、同じ回線を使う別の利用者の失敗を 1 人の成功で帳消しにできる。
- 期限切れの意向を延ばしても、電話番号の確認では改めて SMS のコードを照合する。意向の再開だけで会員にはなれない。
- パスワードの保存は、認証が通った時点でブラウザに頼むだけである。保存するかどうかは利用者が決め、断られても登録とログインは止めない。
- 画面に出す文言は、メールアドレスの有無で変えない。「確認メールを送信しました」と「続きから再開」は、どちらも本人がパスワードを知っている前提でだけ意味を持つ。

## 参考

- `src/modules/auth/components/AuthEntryScreen.tsx` — 登録・ログインのフォームと電話番号の確認画面
- `src/modules/auth/lib/password-credential.ts` — パスワードの保存
- `src/modules/auth/lib/signup-resume.ts` — 登録途中の意向の引き当て
- `src/modules/auth/lib/auth.ts` — `passwordHashMatches`
- `src/app/api/v1/auth/local/route.ts` — ログインの再開処理
- `src/modules/auth/lib/phone.ts` — 意向を引けないときの 401
- [front_implementation_spec.md](../front_implementation_spec.md) — 画面の受け入れ条件（FE-AUTH-16 / 17）
- [backend_api_implementation_spec.md](../backend_api_implementation_spec.md) — 8 章と 8.5
