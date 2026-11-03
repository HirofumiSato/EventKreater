# 出欠の回数制限・セキュリティヘッダ・秘匿URLの noindex

## 背景

前回の棚卸しで、告知ページまわりに 3 つの穴が残っていた。どれも DB スキーマを変えずに塞げるため、独立した 3 本の PR として実装する。

1. **出欠は無認証で POST できる。** 出席・欠席の送信に会員登録は要らない（ゼロフリクション）。そのぶん、同じ端末や同じ回線からの連投を止める仕組みが無く、壊れた本文を送り続けるだけで DB の読み書きを起こせる。
2. **本番の応答ヘッダが既定のまま。** `frame-ancestors` が無いので、未ログインで POST できる出欠の画面を iframe に重ねられる（クリックジャッキング）。招待コードがパスに載るのに `Referrer-Policy` も無い。
3. **招待 URL が noindex から漏れている。** `robots.ts` は `/console` と `/organizers/` だけを拒否し、`/invitations/[code]` は何も付けていない。招待 URL は共同主催の権限を持つため、検索結果に載ってはいけない。

## 現状

- `src/app/api/v1/public/events/[id]/rsvp/route.ts` の POST と DELETE は、どちらも認証を要求しない。上限を数える場所も無い。
- 試行回数の基盤（`auth_attempts`、`attemptWindow`、`limitExtras`、429 の書式と `Retry-After` / `X-RateLimit-*`）は認証のために既にある。出欠はこれをそのまま流用できる。
- `next.config.mjs` の `headers()` は staging の全パス noindex だけを返す。本番は何も付けていない。
- `src/app/robots.ts` の `disallow` は `/console` と `/organizers/` だけである。
- `src/app/invitations/[code]/page.tsx` はクライアントコンポーネントなので、`metadata` を持てない。

## 今回の決定

| 論点 | 決定 |
| :--- | :--- |
| 出欠の上限 | 既存の `src/modules/auth/lib/rate-limits.ts` に `rsvpIp` / `rsvpToken` の 2 ルールを足す。新しいテーブルは作らない |
| セキュリティヘッダ | `next.config.mjs` の `headers()` に足す。`middleware.ts` は作らない |
| CSP | `frame-ancestors` / `object-src` / `base-uri` / `form-action` だけに留める。`script-src` は入れない |
| HSTS | 本番だけ付ける。staging は HTTP で確かめることがあり、付けると戻れなくなる |
| 招待ページ | クライアントコンポーネントの `page.tsx` ではなく、同じ階層の `layout.tsx` が `metadata.robots` を持つ |
| クローラ対策の二重掛け | `robots.txt` の `disallow` と `X-Robots-Tag: noindex, nofollow` を併用する。索引させないことが目的なので、両方付けてよい |

## 数値の根拠

### 出欠の回数制限

| ルール | バケットのキー | 既定 | 調整する環境変数 |
| :--- | :--- | :--- | :--- |
| `rsvpIp` | `rsvp:ip:<eventId>:<sha256(ip)>` | 30 回 / 1 分 | `RSVP_IP_LIMIT`、`RSVP_IP_WINDOW_MINUTES` |
| `rsvpToken` | `rsvp:token:<eventId>:<sha256(cookie token)>` | 10 回 / 10 分 | `RSVP_TOKEN_LIMIT`、`RSVP_TOKEN_WINDOW_MINUTES` |

- **イベントをまたいで数えない。** キーの接頭辞の後ろに必ずイベント ID を入れる。1 つの催しの連投が、別の催しの回答を止めてはいけない。
- **端末側の 10 回 / 10 分は「同じ端末の連打」用。** 1 台が回答を直し続けるのを止める値で、正規の利用者には当たらない。
- **IP 側の 30 回 / 1 分は少人数の催しの前提。** 会場の共有 Wi-Fi では全員が同じ `cf-connecting-ip` になる。1 分あたり 30 人までを許す値なので、**100 人規模が数分に集中する催しでは 429 になり得る**。その場合は `RSVP_IP_LIMIT` を上げる。運営者や会場の回線が分かっている催しでは、先に上げておく。
- **この値では「埋め尽くし」を完全には防げない。** 1 分に 30 人を通すので、定員 30 人の催しなら 1 分で埋まる。主催者の受付停止（`close`）と取り消しを併用する前提であり、回数制限だけで定員を守る設計ではない。
- **未ログインで Cookie が無い送信は、毎回新しい行を作る。** 端末のバケットはその行に付くので、実効的な防御は IP 側だけになる。端末側は「同じ端末が持ち続ける Cookie での連打」に効く。
- **成功した送信も数える。** 失敗だけを数えると、成功し続ける連投を止められない。
- **確認は本文の parse より前、記録は parse の後。** 壊れた本文を連投されても DB の書き込みを起こさないため、`assertWithinAttemptLimit` を先に呼ぶ。記録は入力が正しいと分かってから、トランザクションの前に置く。
- **DELETE は IP のバケットだけを消費する。** 取り消しは正規の操作であり、端末単位の枠を使うと「出し直し」が詰まる。POST と同じ IP のバケットを共有する。
- 環境変数はサーバ専用である。`NEXT_PUBLIC_` は付けない。不正値（0・負数・小数・文字列）は既定値へ戻る。

### セキュリティヘッダ

| ヘッダ | 値 | 目的 |
| :--- | :--- | :--- |
| `X-Content-Type-Options` | `nosniff` | 画像や JSON を別の型として解釈させない |
| `Referrer-Policy` | `strict-origin-when-cross-origin` | 招待コードがパスに載るため必須。クロスオリジンには origin だけを送る |
| `X-Frame-Options` | `DENY` | `frame-ancestors` を読まない古いブラウザ向け |
| `Permissions-Policy` | `camera=(), geolocation=(), microphone=(self)` | 音声入力のために `microphone` だけ開ける。`camera` と `geolocation` は使わないので閉じる |
| `Content-Security-Policy` | `frame-ancestors 'none'; object-src 'none'; base-uri 'self'; form-action 'self'` | iframe への埋め込みを塞ぐのが本命。`form-action 'self'` は外部 `action` を持たないので壊れない（Stripe へは `window.location.href` で遷移する） |
| `Strict-Transport-Security` | `max-age=63072000; includeSubDomains`（本番だけ） | 常時 HTTPS を強制する |

**`script-src` を入れない理由:** Next.js は hydration 用のインライン script を HTML に差し込む。`GoogleAnalytics` も gtag.js を読み、インラインで初期化する。`script-src` を `'self'` だけで閉じると、この 2 つが落ちて画面が動かなくなる。nonce 方式に変えるのは別 PR とし、今回は `frame-ancestors` を優先する。

staging は従来どおり全パスに `X-Robots-Tag: noindex, nofollow` を付ける。パス別の noindex と規則を分けて返すと、同じパスに同じヘッダが 2 行出るため、規則の配列を組み立ててから返す。

### 秘匿 URL の noindex

`X-Robots-Tag: noindex, nofollow` を付けるパスは次のとおり。`<meta>` を読まないクローラ向けに、全環境で付ける。

```text
/console/:path*  /events/:path*  /organizers/:path*  /organizer/:path*
/invitations/:path*  /invite/:path*  /sample/:path*  /auth/:path*
/participant/:path*  /account/:path*  /mypage  /notifications  /api/:path*
```

公開してよいのは `/`・`/service`・`/terms` だけである。`robots.txt` の `disallow` に `/invitations/` を足すのは `/organizers/` と同じ二重掛けで、`X-Robots-Tag` と併用してよい。

## やらないこと

- **参加者の CAPTCHA。** ゼロフリクションの出欠に認証やパズルを挟むと、目的そのものが崩れる。まず回数制限と主催者の受付停止で受ける。
- **CSP の `script-src` の即時導入。** インライン script と GA が落ちる。nonce 方式は別 PR で扱う。
- **`middleware.ts`。** 今回は `next.config.mjs` の `headers()` で足りる。リクエストごとの判定を持ち込むと、静的な配信とモックの撮り直しに影響する。
- **DB スキーマの変更。** `auth_attempts` をそのまま使う。
- **チラシ候補・音声の上限。** 別 PR で扱う。
- **IP レピュテーション、WAF、管理コンソールからの上限変更。**

## 実装方針

PR は 3 本に分ける。1 が出欠の回数制限、2 がセキュリティヘッダ、3 が秘匿 URL の noindex である。どれも DB のマイグレーションを持たない。

### 1. 出欠の回数制限

処理の順序は次のとおり。

1. `loadOpenEvent` で催しを読む（公開状態と期限の判定は従来どおり）。
2. `rsvpIp` に残りがあるかを確かめる。無ければ 429。
3. Cookie の `rsvp_token_<id>` があれば、`rsvpToken` に残りがあるかを確かめる。無ければ 429。
4. `SubmitRsvpSchema.parse` で本文を検証する。
5. `rsvpIp` と `rsvpToken` を記録する（成功も数える）。
6. 出欠のトランザクションを実行する。

DELETE は 2 と 5 だけを行い、`rsvpIp` だけを確かめて記録する。429 の本文には `limitLabel` / `attemptLimit` / `remainingAttempts` / `windowSeconds` / `retryAfterSeconds` / `retryAt` が入り、応答に `Retry-After` / `X-RateLimit-*` が付く。告知ページの `ParticipantSheet` は `readProblem` を使っているので、画面側の変更なしに「この催しへの出欠の回答は1分に30回までです。HH:MMごろに再度お試しください。」が出る。

### 2. セキュリティヘッダ

`next.config.mjs` の `headers()` を 2 段に組み替える。

- `/:path*` の 1 本に、共通の 5 ヘッダと、環境ごとの差分（本番は HSTS、staging は noindex）をまとめる。
- 本番・開発では、秘匿パスごとに `X-Robots-Tag` を返す。
- staging では全パス noindex があるので、パス別の規則は足さない。

### 3. 秘匿 URL の noindex

- `src/app/invitations/[code]/layout.tsx` を新設し、`metadata.robots` を `{ index: false, follow: false }` にする。前例は `src/app/organizer/register-required/layout.tsx` と `src/app/console/layout.tsx`。
- `src/app/robots.ts` の `disallow` に `/invitations/` を足す。
- `next.config.mjs` の秘匿パスに `/invitations/:path*` と `/invite/:path*` を入れる。

## 受け入れ条件

- [ ] 同じ IP から 1 分に 31 回送ると 429 になり、本文に上限の 6 項目と `retryAt` が入る
- [ ] 429 の応答に `Retry-After` / `X-RateLimit-Limit` / `X-RateLimit-Remaining` / `X-RateLimit-Reset` が付く
- [ ] 同じ端末から 10 分に 11 回答えると 429 になる
- [ ] イベントが違えば、同じ IP・同じ端末でも別に数えられる
- [ ] 取り消し（DELETE）は IP のバケットだけを消費する
- [ ] 壊れた本文を連投しても、上限に達するまで DB の出欠行は作られない
- [ ] `RSVP_IP_LIMIT` などを変えると上限と窓が変わり、不正値は既定値に戻る
- [ ] 本番の応答に 5 つのヘッダが付き、CSP に `frame-ancestors 'none'` が入る
- [ ] HSTS は本番だけに付き、staging では付かない
- [ ] staging の応答で `X-Robots-Tag` が 1 行だけになる
- [ ] `/invitations/[code]` の HTML に `noindex, nofollow` が入り、応答ヘッダにも `X-Robots-Tag` が付く
- [ ] `robots.txt` の `disallow` に `/invitations/` が入る
- [ ] 告知ページの出欠が 429 のとき、画面に再試行可能時刻が出る
- [ ] 招待の受諾と、音声入力・出欠の送信がヘッダ追加後も動く

## 参考

- `src/app/api/v1/public/events/[id]/rsvp/route.ts` — 出欠の送信・取り消し
- `src/modules/auth/lib/rate-limits.ts` — 上限の一覧（`rsvpIp` / `rsvpToken`）
- `src/modules/auth/lib/rate-limit.ts` — 窓の計算と記録
- `src/lib/http.ts` — 429 のヘッダ
- `src/lib/problem.ts` — 画面側の上限の案内
- `next.config.mjs` — セキュリティヘッダと `X-Robots-Tag`
- `src/app/robots.ts` — `robots.txt`
- `src/app/invitations/[code]/layout.tsx` — 招待ページの `metadata`
- `src/components/common/GoogleAnalytics.tsx` — `script-src` を入れない理由
- `docs/issues/auth-attempt-limits.md` — 上限と表示の元の設計
- `docs/backend_api_implementation_spec.md` — API 仕様
- `docs/overall_system_requirements_common.md` — 要件
- `docs/front_implementation_spec.md` — 画面の受け入れ条件
- `docs/staging.rst` — ステージングでの確認手順
