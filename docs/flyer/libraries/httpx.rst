HTTPX
=====

目的
----

画像生成 API が返す画像 URL からバイト列をダウンロードします。テストでは実ネットワークの代わりにモックトランスポートを使います。

使い方
------

ダウンロード関数は ``src/adapters/image_generator/dalle_image_generator.py`` の ``download_image`` です。タイムアウトは画像生成の残り予算を渡し、リダイレクトは追跡します。

テストでは ``httpx.MockTransport`` と ``httpx.AsyncClient(transport=...)`` を ``download_image`` の ``client`` に渡します。HTML など画像でない本体は拒否します。

Tips
----

* 取得サイズの上限は 20 MB です。超えた応答は画像生成失敗として静的背景へ落とします。
* バイト列は Pillow で開けることまで確認します。壊れた PNG をレンダラーへ渡して 500 にしないためです。
* FastAPI の ``TestClient`` も内部で HTTPX を使います。API 結合テストのために別途サーバーは立ち上げません。
* OpenAI SDK が依存する HTTP 実装とは別に、このダウンロードだけがアプリ側の HTTPX 呼び出しです。
