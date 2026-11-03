# メール中継（Cloudflare Worker）

staging と本番のアプリは `MAIL_WEBHOOK_URL` へ `{ to, subject, body }` を POST するだけで、
メールは自分では送らない（送れないと `[mail]` ログに落ちる）。この Worker が受け取って
Resend で送る。staging と production は同じ実装（`src/handler.mjs`）を使い、違いは
wrangler の設定（アプリ名・ホスト名・件名の接頭辞）だけにする。

```
event-creater-web-stg
  -> POST https://mail-hook-stg.eventkreater.com/<WEBHOOK_TOKEN>
     -> Resend（送信ドメイン send-stg.eventkreater.com）
  -> 運用者のメール

event-creater-web（本番）
  -> POST https://mail-hook.eventkreater.com/<WEBHOOK_TOKEN>
     -> Resend（送信ドメイン send.eventkreater.com）
  -> 参加者・主催者のメール
```

## 環境ごとの違い

| 環境 | config | Worker 名 | ホスト名 | 件名の接頭辞 |
| --- | --- | --- | --- | --- |
| staging | `wrangler.toml` | `event-creater-mail-stg` | `mail-hook-stg.eventkreater.com` | `[stg] ` |
| production | `wrangler.prod.toml` | `event-creater-mail` | `mail-hook.eventkreater.com` | なし |

`wrangler deploy` は既定でカレントの `wrangler.toml` を読みます。本番を触るときは必ず
`--config wrangler.prod.toml` を付けてください。

## 設定

### `[vars]` で持つもの（秘密ではない）

| 名前 | 内容 |
| --- | --- |
| `SUBJECT_PREFIX` | 件名の頭に付ける接頭辞。staging は `[stg] `、本番は未設定で空として扱う |

件名は `SUBJECT_PREFIX + subject` になります。文字列でない値は空として扱うので、設定を
間違えても中継そのものは止まりません。以前は `src/handler.mjs` の定数でしたが、いまは
環境ごとに `[vars]` で決めます。

### 秘密（`wrangler secret put` で入れる）

| 名前 | 内容 |
| --- | --- |
| `RESEND_API_KEY` | Resend の API キー |
| `WEBHOOK_TOKEN` | URL のパスに載せる合言葉。一致しないパスは 404 |
| `MAIL_FROM` | 送信元。staging は `no-reply@send-stg.eventkreater.com`、本番は `no-reply@send.eventkreater.com` |
| `ALLOWED_RECIPIENTS` | 送ってよい宛先。カンマ区切り |

`ALLOWED_RECIPIENTS` の書き方:

- `@example.com` の形はドメイン全体、それ以外は完全一致（大小は区別しない）。
- `*` を書くと全宛先を許可する。本番で参加者・主催者へ直接送るにはこれが要る。
- 空（未設定を含む）なら全拒否。`*` と空は別の意味なので、消したままにしない。

### `WEBHOOK_TOKEN` とアプリの設定

`WEBHOOK_TOKEN` は URL のパスに入ります。アプリ側は次の値にします。

- staging: `MAIL_WEBHOOK_URL=https://mail-hook-stg.eventkreater.com/<WEBHOOK_TOKEN>`
- production: `MAIL_WEBHOOK_URL=https://mail-hook.eventkreater.com/<WEBHOOK_TOKEN>`

秘密は `wrangler secret put` で入れます。手元の `.dev.vars` はコミットしないでください
（`.gitignore` 済み）。

## デプロイ

### CI から

`.github/workflows/deploy-env.yml` の `mail` ジョブが `wrangler deploy` を流します。

- environment secrets の `CLOUDFLARE_API_TOKEN` と `CLOUDFLARE_ACCOUNT_ID` が入っているときだけ動きます（どちらも `required: false` です）。未設定ならジョブを飛ばします。
- config とホストは環境で変わります。production は `wrangler.prod.toml` と `mail-hook.eventkreater.com`、staging は `wrangler.toml` と `mail-hook-stg.eventkreater.com` です。
- デプロイのあと `GET /health` を叩き、`{"ok":true}` が返ることを確かめます。ホスト・証明書・Worker の 3 つがそろったことの確認です。返りが想定外ならジョブは失敗します。

### 初回だけ手元で

秘密は CI では扱いません。最初の 1 回だけ、環境ごとに手元で入れます。

```powershell
cd infra/mail-webhook
wrangler login

# staging（既定の wrangler.toml）
wrangler secret put RESEND_API_KEY
wrangler secret put WEBHOOK_TOKEN
wrangler secret put MAIL_FROM           # 例: no-reply@send-stg.eventkreater.com
wrangler secret put ALLOWED_RECIPIENTS  # 例: @example.com,ops@example.net
wrangler deploy

# production
wrangler secret put RESEND_API_KEY        --config wrangler.prod.toml
wrangler secret put WEBHOOK_TOKEN         --config wrangler.prod.toml
wrangler secret put MAIL_FROM             --config wrangler.prod.toml  # no-reply@send.eventkreater.com
wrangler secret put ALLOWED_RECIPIENTS    --config wrangler.prod.toml  # 全宛先なら *
wrangler deploy --config wrangler.prod.toml
```

- 本番の秘密は `--config wrangler.prod.toml` を付けます。付け忘れると staging の Worker に入ります。
- `SUBJECT_PREFIX` は秘密ではないので `wrangler secret put` では入れません。`[vars]` にだけ書きます。

## Cloudflare Access は付けない

アプリは認証ヘッダを付けられない。Access を付けるとブラウザのログインを要求され、
Worker まで届かないまま `RECORDED`（未送信）になる。代わりにパスの `WEBHOOK_TOKEN` で弾く。
漏れたら作り直して `fly secrets set` をやり直す。

本番の `mail-hook.eventkreater.com` にも同じ理由で付けません。付けると、確認メールも課金の
事前通知もすべて未送信になります。

## 疎通

```powershell
curl.exe -i -X POST "https://mail-hook.eventkreater.com/<WEBHOOK_TOKEN>" `
  -H "Content-Type: application/json" `
  -d "{\"to\":\"you@example.com\",\"subject\":\"疎通\",\"body\":\"test\"}"
```

staging を確かめるときは、ホスト名だけを `mail-hook-stg.eventkreater.com` に変えます。

`GET https://mail-hook.eventkreater.com/health` は `{"ok":true}` を返します（staging は
`https://mail-hook-stg.eventkreater.com/health`）。

## 失敗したとき

| 応答 | 原因 |
| --- | --- |
| `202` | 送信できた |
| `400` | 本文が JSON でない、`to` / `subject` / `body` が空か形違い |
| `403` | `ALLOWED_RECIPIENTS` に無い宛先。`ALLOWED_RECIPIENTS` が空のときもここで止まる |
| `404` | トークン違い（または `WEBHOOK_TOKEN` 未設定） |
| `413` | 件名が 200 文字、本文が 10000 文字を超えた |
| `502` | Resend の鍵か送信ドメイン（鍵違い・ドメイン未認証） |

`POST` 以外は `405`、`GET /health` だけは認証なしの `200` です。

失敗してもアプリの画面は成功表示のままなので、`fly logs` に `[mail]` が出ていないかで確かめる。
Worker 側のログには理由コードだけが出る（宛先・件名・本文は出さない）。
