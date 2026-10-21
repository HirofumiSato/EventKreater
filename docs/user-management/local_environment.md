# ローカル環境の起動と停止

この PC の開発環境は、ホストに置いた PostgreSQL 16 と、プロジェクト直下で動かす Next.js で構成しています。PostgreSQL は Windows サービスにも Docker にも登録していません。データディレクトリは `C:\Users\hisat\local-pgsql\data`、実行ファイルは `C:\Users\hisat\local-pgsql\pgsql\bin` です。

| 役割 | 場所 | 確認先 |
| --- | --- | --- |
| SQL サーバー（PostgreSQL 16.4） | `127.0.0.1:5432` | データベース `event_platform_dev`、ロール `hisat` |
| Web / API（Next.js） | `http://localhost:3000` | `http://localhost:3000/api/v1/health` |
| DB の画面確認（任意） | Prisma Studio | `http://localhost:5555` |

接続情報はプロジェクト直下の `.env` の `DATABASE_URL` にあります。コマンドは PowerShell で、アプリの操作はプロジェクトのルート（`package.json` があるディレクトリ）で実行します。

起動は PostgreSQL、アプリの順です。停止はその逆です。

## PostgreSQL を起動する

```powershell
& "$env:USERPROFILE\local-pgsql\pgsql\bin\pg_ctl.exe" `
  -D "$env:USERPROFILE\local-pgsql\data" `
  -l "$env:USERPROFILE\local-pgsql\postgres.log" `
  start
```

起動ログは `C:\Users\hisat\local-pgsql\postgres.log` に追記されます。サーバーがすでに動いているときは、`pg_ctl` が別のサーバーが動作中だと報告して終了します。その場合は停止せず、次の確認へ進みます。

## PostgreSQL を確認する

状態、待受、データベースへの接続を順に見ます。

```powershell
& "$env:USERPROFILE\local-pgsql\pgsql\bin\pg_ctl.exe" `
  -D "$env:USERPROFILE\local-pgsql\data" `
  status
```

動いていれば `サーバーは稼働中です` と PID が表示されます。停止中なら `サーバーは停止しています` と表示されます。

```powershell
& "$env:USERPROFILE\local-pgsql\pgsql\bin\pg_isready.exe" -h localhost -p 5432
```

接続を受け付けていれば、次の表示になります。

```text
localhost:5432 - 接続を受け付けています
```

```powershell
& "$env:USERPROFILE\local-pgsql\pgsql\bin\psql.exe" `
  -h localhost -p 5432 -U hisat -d event_platform_dev `
  -c "SELECT current_database() AS db, current_user AS usr;"
```

このローカル接続はパスワードを尋ねません。結果が `event_platform_dev` と `hisat` なら、アプリが使うデータベースへ入れています。

画面でテーブルを見るときは、プロジェクトのルートで次を実行します。ブラウザで `http://localhost:5555` を開きます。

```powershell
npm run db:studio
```

## アプリを起動する

PostgreSQL が接続を受け付けていることを確認してから、プロジェクトのルートで開発サーバーを起動します。

```powershell
npm run dev
```

待受が始まると、ターミナルに `http://localhost:3000` が表示されます。このターミナルは起動したままにします。

初回、または依存関係を変えたあとは、起動の前に `npm install` を実行します。スキーマを変えたあとは `npm run db:migrate` を実行します。

## アプリを確認する

ブラウザで `http://localhost:3000` を開きます。データベースまで含めて確認するときは、別の PowerShell でヘルスチェックを呼びます。

```powershell
Invoke-RestMethod http://localhost:3000/api/v1/health
```

PostgreSQL へ接続できていれば `ok` が `True` です。データベースが止まっているときは、API が「データベースに接続できません。」を返します。

## アプリを停止する

`npm run dev` を実行しているターミナルで `Ctrl+C` を押します。Prisma Studio を開いている場合も、そのターミナルで `Ctrl+C` を押します。

ターミナルを閉じたあとにプロセスだけが残っているときは、待受ポートから止めます。

```powershell
Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue |
  ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }
```

Prisma Studio（ポート `5555`）も同じ方法で止められます。`LocalPort` を `5555` に変えて実行します。

## PostgreSQL を停止する

アプリと Prisma Studio を止めてから、データディレクトリを指定して停止します。

```powershell
& "$env:USERPROFILE\local-pgsql\pgsql\bin\pg_ctl.exe" `
  -D "$env:USERPROFILE\local-pgsql\data" `
  stop
```

この停止は、接続中のクライアントが切断するまで待ちます。アプリを止めたあとも戻らないときは、接続を切ってから停止します。

```powershell
& "$env:USERPROFILE\local-pgsql\pgsql\bin\pg_ctl.exe" `
  -D "$env:USERPROFILE\local-pgsql\data" `
  stop -m fast
```

停止できたかは、もう一度 `pg_ctl status` を実行して確認します。`サーバーは停止しています` と出れば完了です。

## 起動と停止の順

1. `pg_ctl start` で PostgreSQL を起動する。
2. `pg_isready` と `psql` で `event_platform_dev` へ接続できることを確認する。
3. プロジェクトのルートで `npm run dev` を実行する。
4. `http://localhost:3000/api/v1/health` で `ok` が `True` であることを確認する。
5. 終了するときは、開発サーバーを `Ctrl+C` で止めてから `pg_ctl stop` を実行する。
