# staging のメール中継（Cloudflare Worker）

staging のアプリは `MAIL_WEBHOOK_URL` へ `{ to, subject, body }` を POST するだけで、
メールは自分では送らない（送れないと `[mail]` ログに落ちる）。この Worker が受け取って
Resend で送る。staging 専用。

```
event-creater-web-stg
  -> POST https://mail-hook-stg.eventkreater.com/<WEBHOOK_TOKEN>
  -> Resend（送信ドメイン send-stg.eventkreater.com）
  -> 運用者のメール
```

## デプロイ

```powershell
cd infra/mail-webhook
wrangler login
wrangler secret put RESEND_API_KEY
wrangler secret put WEBHOOK_TOKEN
wrangler secret put MAIL_FROM           # 例: no-reply@send-stg.eventkreater.com
wrangler secret put ALLOWED_RECIPIENTS  # 例: @example.com,ops@example.net
wrangler deploy
```

- `ALLOWED_RECIPIENTS` はカンマ区切り。`@example.com` の形はドメイン全体、それ以外は完全一致（大小は区別しない）。空なら全拒否。
- `WEBHOOK_TOKEN` は URL のパスに入る。アプリ側は `MAIL_WEBHOOK_URL=https://mail-hook-stg.eventkreater.com/<WEBHOOK_TOKEN>`。
- 秘密は `wrangler secret put` で入れる。手元の `.dev.vars` はコミットしない（`.gitignore` 済み）。

## Cloudflare Access は付けない

アプリは認証ヘッダを付けられない。Access を付けるとブラウザのログインを要求され、
Worker まで届かないまま `RECORDED`（未送信）になる。代わりにパスの `WEBHOOK_TOKEN` で弾く。
漏れたら作り直して `fly secrets set` をやり直す。

## 疎通

```powershell
curl.exe -i -X POST "https://mail-hook-stg.eventkreater.com/<WEBHOOK_TOKEN>" `
  -H "Content-Type: application/json" `
  -d "{\"to\":\"you@example.com\",\"subject\":\"疎通\",\"body\":\"test\"}"
```

- `202` 送信できた
- `403` 許可リスト外の宛先
- `404` トークン違い（または `WEBHOOK_TOKEN` 未設定）
- `502` Resend の鍵か送信ドメイン

`GET https://mail-hook-stg.eventkreater.com/health` は `{"ok":true}` を返す。

失敗してもアプリの画面は成功表示のままなので、`fly logs` に `[mail]` が出ていないかで確かめる。
