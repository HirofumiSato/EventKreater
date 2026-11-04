# SMS 中継（Cloudflare Worker）

staging と本番のアプリは `SMS_WEBHOOK_URL` へ `{ to, body }` を POST するだけで、
SMS は自分では送らない（送れないと `[sms]` ログに落ちる）。この Worker が受け取って
Twilio で送る。staging と production は同じ実装（`src/handler.mjs`）を使い、違いは
wrangler の設定（アプリ名・ホスト名）だけにする。

```
event-creater-web-stg
  -> POST https://sms-hook-stg.eventkreater.com/<WEBHOOK_TOKEN>
     -> Twilio Messages API（英数字 Sender ID）
  -> 運用者の携帯

event-creater-web（本番）
  -> POST https://sms-hook.eventkreater.com/<WEBHOOK_TOKEN>
     -> Twilio Messages API（英数字 Sender ID）
  -> 参加者・主催者の携帯
```

## 環境ごとの違い

| 環境 | config | Worker 名 | ホスト名 | 許可する宛先 |
| --- | --- | --- | --- | --- |
| staging | `wrangler.toml` | `event-creater-sms-stg` | `sms-hook-stg.eventkreater.com` | 運用者自分の番号だけ |
| production | `wrangler.prod.toml` | `event-creater-sms` | `sms-hook.eventkreater.com` | `*`（全宛先） |

`wrangler deploy` は既定でカレントの `wrangler.toml` を読みます。本番を触るときは必ず
`--config wrangler.prod.toml` を付けてください。

## 設定

### 秘密（`wrangler secret put` で入れる）

| 名前 | 内容 |
| --- | --- |
| `TWILIO_ACCOUNT_SID` | Twilio の Account SID（`AC` で始まる 34 文字） |
| `TWILIO_AUTH_TOKEN` | Twilio の Auth Token。Basic 認証のパスワード |
| `SMS_FROM` | 送信元の英数字 Sender ID。例 `EVENTKRTR` |
| `WEBHOOK_TOKEN` | URL のパスに載せる合言葉。一致しないパスは 404 |
| `ALLOWED_RECIPIENTS` | 送ってよい宛先。カンマ区切り |

`SMS_FROM` は 3〜11 文字、英字を 1 つ以上含む ASCII にします（Twilio の英数字
Sender ID の条件）。数字だけや記号入りは Twilio 側で拒否されます（`21606`）。

`ALLOWED_RECIPIENTS` の書き方:

- 電話番号は完全一致（例 `+819012345678`）。メール中継と違い `@example.com` の
  ようなドメイン指定はありません。
- `*` を書くと全宛先を許可する。本番で参加者・主催者へ直接送るにはこれが要る。
- 空（未設定を含む）なら全拒否。`*` と空は別の意味なので、消したままにしない。

### `WEBHOOK_TOKEN` とアプリの設定

`WEBHOOK_TOKEN` は URL のパスに入ります。アプリ側は次の値にします。

- staging: `SMS_WEBHOOK_URL=https://sms-hook-stg.eventkreater.com/<WEBHOOK_TOKEN>`
- production: `SMS_WEBHOOK_URL=https://sms-hook.eventkreater.com/<WEBHOOK_TOKEN>`

秘密は `wrangler secret put` で入れます。手元の `.dev.vars` はコミットしないでください
（`.gitignore` 済み）。

## Twilio 側の準備

1. アカウントを Upgrade する。試用アカウントでは英数字 Sender ID が使えません。
2. Console のトップから Account SID と Auth Token を控え、`wrangler secret put` で入れる。
3. 送信元は英数字 Sender ID（国際ゲートウェイ）にする。登録は不要で、片方向
   （送信のみ）です。日本向けは 1 通 $0.089。
4. 国内ゲートウェイ（`+81` の番号）は登録に約 5 週間かかるため使いません。
5. Messaging Service は作りません。`Messages.json` を直接叩きます。

宛先は E.164（`+819012345678`）で渡します。本文に電話番号は書きません
（日本のガイドラインで禁止）。本文は 1000 文字までで、超えた要求は `413` で捨てます。

## デプロイ

### CI から

`.github/workflows/deploy-env.yml` の `sms` ジョブが `wrangler deploy` を流します
（`mail` ジョブと同じ形）。

- environment secrets の `CLOUDFLARE_API_TOKEN` と `CLOUDFLARE_ACCOUNT_ID` が入っているときだけ動きます。未設定ならジョブを飛ばします。
- config とホストは環境で変わります。production は `wrangler.prod.toml` と `sms-hook.eventkreater.com`、staging は `wrangler.toml` と `sms-hook-stg.eventkreater.com` です。
- デプロイのあと `GET /health` を叩き、`{"ok":true}` が返ることを確かめます。ホスト・証明書・Worker の 3 つがそろったことの確認です。返りが想定外ならジョブは失敗します。

### 初回だけ手元で

秘密は CI では扱いません。最初の 1 回だけ、環境ごとに手元で入れます。

```powershell
cd infra/sms-webhook
wrangler login

# staging（既定の wrangler.toml）
wrangler secret put TWILIO_ACCOUNT_SID
wrangler secret put TWILIO_AUTH_TOKEN
wrangler secret put SMS_FROM            # 例: EVENTKRTR
wrangler secret put WEBHOOK_TOKEN
wrangler secret put ALLOWED_RECIPIENTS  # 例: +819012345678
wrangler deploy

# production
wrangler secret put TWILIO_ACCOUNT_SID  --config wrangler.prod.toml
wrangler secret put TWILIO_AUTH_TOKEN   --config wrangler.prod.toml
wrangler secret put SMS_FROM            --config wrangler.prod.toml  # EVENTKRTR
wrangler secret put WEBHOOK_TOKEN       --config wrangler.prod.toml
wrangler secret put ALLOWED_RECIPIENTS  --config wrangler.prod.toml  # 全宛先なら *
wrangler deploy --config wrangler.prod.toml
```

- 本番の秘密は `--config wrangler.prod.toml` を付けます。付け忘れると staging の Worker に入ります。
- Fly 側は URL だけを持ちます。`flyctl secrets set SMS_WEBHOOK_URL="https://sms-hook.eventkreater.com/<WEBHOOK_TOKEN>" -a event-creater-web`。

## Cloudflare Access は付けない

アプリは認証ヘッダを付けられない。Access を付けるとブラウザのログインを要求され、
Worker まで届かないまま `RECORDED`（未送信）になる。代わりにパスの `WEBHOOK_TOKEN` で弾く。
漏れたら作り直して `fly secrets set` をやり直す。

本番の `sms-hook.eventkreater.com` にも同じ理由で付けません。付けると、電話番号の確認も
ログインの確認番号もすべて未送信になります。

## レート制限は 1 ゾーン 1 本まで

Cloudflare の無料枠は、1 ゾーンにつきレート制限ルールを **1 本**しか持てません。
2 本目を足すと、API は `50001 exceeded the maximum number of rules in the phase
http_ratelimit: 2 out of 1` を返します。そのため `/console/` の既存ルールに OR で
中継のホストを足し、1 本にまとめています。

- 式: `(starts_with(http.request.uri.path, "/console/")) or (http.host eq "mail-hook.eventkreater.com") or (http.host eq "sms-hook.eventkreater.com")`
- しきい値: `20 requests / 10 seconds`、characteristics は `ip.src` と `cf.colo.id`、`mitigation_timeout` は 10 秒、action は `block`

## 疎通

```powershell
curl.exe -i -X POST "https://sms-hook.eventkreater.com/<WEBHOOK_TOKEN>" `
  -H "Content-Type: application/json" `
  -d "{\"to\":\"+819012345678\",\"body\":\"疎通\"}"
```

staging を確かめるときは、ホスト名を `sms-hook-stg.eventkreater.com` に変え、
`to` は `ALLOWED_RECIPIENTS` に入れた自分の番号にします。

`GET https://sms-hook.eventkreater.com/health` は `{"ok":true}` を返します（staging は
`https://sms-hook-stg.eventkreater.com/health`）。

## ローカルで試す

`infra/sms-webhook/.dev.vars` を作り（コミットしない）、`wrangler dev` で起動します。

```
TWILIO_ACCOUNT_SID="AC..."
TWILIO_AUTH_TOKEN="..."
SMS_FROM="EVENTKRTR"
WEBHOOK_TOKEN="local-token"
ALLOWED_RECIPIENTS="+819012345678"
```

```powershell
wrangler dev
curl.exe -i -X POST "http://127.0.0.1:8787/local-token" `
  -H "Content-Type: application/json" `
  -d "{\"to\":\"+819012345678\",\"body\":\"疎通\"}"
```

`wrangler dev` は本物の Twilio を叩くので、通数を増やしたくないときは
`ALLOWED_RECIPIENTS` を空にして `403` までを確かめます。送信の分岐は
`send` を差し替えた単体テストで確かめます（ネットワークも DB も使わない）。

## 失敗したとき

| 応答 | 原因 |
| --- | --- |
| `202` | 送信できた（Twilio の 201 を 202 に写す） |
| `400` | 本文が JSON でない、`to` / `body` が空か形違い（`to` は E.164 のみ） |
| `403` | `ALLOWED_RECIPIENTS` に無い宛先。`ALLOWED_RECIPIENTS` が空のときもここで止まる |
| `404` | トークン違い（または `WEBHOOK_TOKEN` 未設定） |
| `413` | 本文が 1000 文字を超えた |
| `502` | Twilio の鍵・Sender ID・宛先（SID / トークン違い、`21211`、`21606`） |

`POST` 以外は `405`、`GET /health` だけは認証なしの `200` です。

失敗してもアプリの画面は成功表示のままなので、`fly logs` に `[sms]` が出ていないかで確かめる。
Worker 側のログには理由コードと Twilio の `code` だけが出る（宛先・本文は出さない）。
