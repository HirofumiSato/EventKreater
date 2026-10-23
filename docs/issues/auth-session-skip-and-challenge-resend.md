# ログイン済みセッションがあるときは再認証を省き、ログイン確認番号に再送ボタンを付ける

> 起票済み: [#54](https://github.com/HirofumiSato/EventKreater/issues/54)。このファイルは設計の記録として残す。

## 背景

1. **有効なセッション Cookie を持っていても、ログイン画面を開くとパスワードと確認番号をやり直させられる。** セッションは 7 日間有効で、DB の `auth_sessions` まで照合し、ログアウトと退会で失効させている。なのに `/auth/register` と `/participant/login` は Cookie を見ずにフォームを出していた。管理コンソールだけは `GET /api/v1/admin/session` で既にログイン済みを検知して `/console` へ送っており、会員側だけが非対称だった。
2. **ログイン確認番号の画面に再送手段が無かった。** `?step=login-code` はチャネルの切り替え（「SMSが届かないのでメールで受け取る」／「SMSで受け取る」）しか持たず、同じ宛先へ送り直せなかった。SMS が遅れただけで詰まる。なお電話番号確認の `?step=phone` には再送ボタンが実装済みで、欠けていたのはログイン第二段階だけである。

## 現状と根拠

| 画面 | セッションの確認 | 再送 |
| :--- | :--- | :--- |
| `/auth/register`、`/participant/login` | なし。常にフォーム | — |
| `?step=login-code`（`LoginChallengeForm`） | なし | なし（チャネル切替のみ） |
| `?step=phone`（`PhoneScreen`） | あり（`GET /api/v1/user/profile`） | あり |
| `/console/login` | あり（`GET /api/v1/admin/session`） | なし（管理者は電話必須のため実害が小さい） |

- ログインは毎回 `startLoginChallenge()` で新しい確認番号を発行する（`src/app/api/v1/auth/local/route.ts`、`src/app/api/v1/auth/google/callback/route.ts`）。
- `GET /api/v1/user/profile` は `phoneVerified` を返すが `platformRole` を返さない。着地の判定に管理者ロールが要るため、そのままでは使えない。
- `switchLoginChallengeChannel()` は同じチャネルを渡しても、未使用の旧チャレンジを使用済みにして新しい行を作る（`src/modules/auth/lib/login-challenge.ts`）。API を足さずに再送を実装できる。
- 確認番号の SMS は会員あたり 1 時間に 5 回、メールも 5 回。IP あたりはどちらも 10 回（`src/modules/auth/lib/rate-limits.ts`）。
- `phone/start` と `phone/confirm` は `resolveUserId` を使っており、**失効した Cookie が残っていると 401 で止まっていた**。そのため `signup_intent` による登録の続きができなくなることがあった。

## 今回の決定

| 論点 | 決定 |
| :--- | :--- |
| スキップの条件 | 有効な `auth_token` があること。Cookie の存在ではなく、`auth_sessions` の行まで見る |
| 判定の API | `GET /api/v1/auth/session` を新設。`authenticated`、`pendingChallenge`、`user`（`phoneVerified` / `platformRole`）を返す |
| 電話未確認の会員 | ログインは省くが `?step=phone` へは進める。無料枠の要件は変えない |
| 適用する画面 | `/auth/register`、`/participant/login`。`?step=phone` は画面自身の判定に任せる |
| 着地 | 明示された `next` → 主催者の入口で `next` の無い管理者は `/console` → 入口ごとの既定 |
| 別の会員で入り直す | `?switch=1` のときだけフォームを出す。確認番号の入力待ち（`pendingChallenge`）も飛ばさない |
| 再送 | `?step=login-code` に「確認番号を再送する」を追加。`POST /api/v1/auth/login-challenge` に同じチャネルを渡す |
| クールダウン | 60 秒。画面だけが持ち、サーバの回数上限とは別に扱う |
| 失敗時の案内 | 上限はサーバのまま。429 のときは既存の `limitNotice` が上限と再試行時刻を出す |
| 壊れた Cookie | `phone/start` と `phone/confirm` を `resolveOptionalUserId` に変え、未ログインとして `signup_intent` で続ける |

## 実装

### 1. 判定の API

`src/app/api/v1/auth/session/route.ts`。`resolveOptionalUserId` で会員を引き、`phoneVerifiedAt` と `platformRole` を返す。401 は `{ "authenticated": false }`。`login_challenge` Cookie の指すチャレンジが未使用かつ期限内なら `pendingChallenge: true`。

Cookie を消す・セッションを作るといった副作用は持たせない。GET は読むだけにした。`login_challenge` を消すと、共用端末での入り直しが途中で壊れる。

### 2. 着地の判定

`src/modules/auth/lib/auth-landing.ts` に純関数を置いた。

| 関数 | 役割 |
| :--- | :--- |
| `phoneStepHref(basePath, hasExplicitNext, nextPath)` | `?step=phone` の URL。`next` は明示されたときだけ付ける |
| `resolveAuthLanding({ audience, hasExplicitNext, nextPath, platformRole })` | 確認済み会員の着地。管理者を `/console` へ送るのは主催者の入口で `next` の無いときだけ |
| `resolveSessionDestination(input)` | 未確認なら `?step=phone`、確認済みなら着地 |
| `isSwitchingAccount(value)` | `switch=1` だけを真とする |

`AuthEntry.finish()` と入口のスキップが同じ関数を使うので、着地の規則が 2 か所に分かれない。

### 3. 画面

`src/modules/auth/hooks/useExistingSession.ts` が `GET /api/v1/auth/session` を 1 回だけ呼ぶ。状態は `checking` / `authenticated` / `anonymous` の 3 つである。

- `checking` と `authenticated` のあいだは、フォームではなく「ログイン状態を確認しています」を出す。入力欄が見えてすぐ消えるちらつきを避ける。
- 通信に失敗したとき、401 のときは `anonymous` に落として通常のフォームを出す。**フェイルオープン**にして、判定の失敗でログインできなくなることを防ぐ。
- `?switch=1` では照会せず、意図的にフォームを出す。`?step=phone` は照会するが、確認済みのときの移動は `PhoneScreen` に任せる。以前は同じ判定を `GET /api/v1/user/profile` でも行っていたので、取得を 1 回に寄せた。
- 電話番号の確認画面は、ログイン済みの会員には「ログイン画面へ戻る」ではなく「あとで確認する」（着地へのリンク）を出す。戻るリンクのままだと、スキップによって同じ確認画面へ送り返されて詰む。

### 4. 再送

`LoginChallengeForm` に「確認番号を再送する」を足した。`deliver(channel, intent)` の `intent` が `resend` のとき、案内を「確認番号を 090****5678 へ送り直しました。」にする。成功したら入力中のコードを消し、クールダウンをやり直す。

`src/modules/auth/lib/resend.ts` の `remainingCooldownSeconds(sentAt, now, cooldownMs = 60_000)` が残り秒数を返す。画面は 1 秒ごとに描き直し、0 になったらタイマーを止める。この画面に来た時点で 1 通は送れているので、初回表示でもクールダウンを始める。

### 5. 壊れた Cookie の扱い

`phone/start` と `phone/confirm` の `resolveUserId` を `resolveOptionalUserId` に変えた。失効した Cookie は未ログインとして扱い、`signup_intent` で登録を続けられる。

## テスト

- `tests/unit/auth-landing.test.ts` — 着地の分岐（`next` の有無 × 入口 × 役割 × 電話の確認状況）と `switch=1` の判定。
- `tests/unit/resend-cooldown.test.ts` — 0 秒・59.5 秒・60 秒・経過後、送信前、時計が戻ったとき、窓の長さの上書き。
- `tests/integration/login-challenge.test.ts`（`TEST_DATABASE_URL` があるときだけ）— 同じ宛先への再送で旧チャレンジが `usedAt` になり新 ID が返る。送信を重ねると 429 になり `limitLabel`・`attemptLimit`・`retryAt` が付く。メールへ切り替えると `destinationMask` と使える手段が変わる。

## 受け入れ条件

- [x] 確認済み会員の Cookie で `/auth/register?next=/organizer/events` を開くと、フォームを出さずに `/organizer/events` へ着地する
- [x] 参加者の入口では `/participant`（`next` があればそのパス）へ着地する
- [x] 管理者が主催者の入口を `next` なしで開くと `/console` へ着地する
- [x] 電話未確認の会員は `?step=phone` へ進み、確認後は `next` へ戻る
- [x] Cookie なし・期限切れ・失効済みは従来どおりフォームが出る
- [x] `?switch=1` ならフォームが出る
- [x] 確認番号の画面で再送ボタンが押せ、60 秒は残り秒数付きで無効
- [x] 再送すると前の確認番号は通らず、新しい番号だけが通る
- [x] 6 回目の送信は 429 になり、上限と再試行時刻が出る
- [x] ロック中・送信中は再送ボタンが無効
- [x] 壊れた Cookie が残っていても、電話番号の確認を続けられる

## スコープ外

- Google コールバックでのセッション再利用（今回は入口ページのみ）。`?switch=1` 付きの Google ログインは、コールバックが `pendingChallenge` を作るのでスキップされない。
- サーバ側での 60 秒クールダウンの強制。
- マイページの電話番号変更（`PhoneChangePanel`）の再送導線。
- パスワードレス化、パスキー。

## セキュリティ上の判断

- 省いたのは「再ログイン」だけで、認証の強度は下げていない。Cookie は httpOnly・SameSite=Lax・HTTPS では `__Host-` と `Secure`。セッションは DB で失効でき、退会と電話番号変更で他の端末を切る。
- セッションの有無は API の応答でしか返さない。画面は着地を決めるだけで、会員の情報を HTML に埋めない。
- `?switch=1` は URL だけで判定する。共用端末で別の会員になる操作は、結局パスワードと確認番号を通すので、URL を知っていても認証は越えられない。
- 壊れた Cookie を未ログイン扱いにしたのは、`signup_intent` の持ち主が本人であることを確認メールと SMS で確かめているためである。Cookie の存在を権限の根拠にしていない。

## 参考

- `src/app/api/v1/auth/session/route.ts` — 入口のセッション確認
- `src/modules/auth/lib/auth-landing.ts` — 着地の判定
- `src/modules/auth/hooks/useExistingSession.ts` — 入口のスキップ
- `src/modules/auth/lib/resend.ts` — 再送のクールダウン
- `src/modules/auth/components/LoginChallengeForm.tsx` — 確認番号の画面と再送
- `src/modules/auth/components/AuthEntryScreen.tsx` — 登録・ログイン・電話番号確認
- `src/modules/auth/lib/login-challenge.ts` — 確認番号の発行・照合・ロック
- `docs/front_implementation_spec.md` — 画面の受け入れ条件（FE-AUTH-14 / 15）
- `docs/backend_api_implementation_spec.md` — 8.7.1 と 8.5
