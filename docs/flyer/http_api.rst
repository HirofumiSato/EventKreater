HTTP API
========

起動すると Swagger UI が ``/docs`` に出ます。画面の操作は :doc:`swagger`、サーバーの立ち上げは :doc:`local_run` です。

.. code-block:: powershell

   python -m uvicorn src.main:app --reload

死活確認
--------

``GET /health``

.. code-block:: json

   {"status": "ok"}

ウィザードの候補を作る
----------------------

画面は「背景 → 紙面の性格」の 2 ステップで候補を選びます。
候補はすべて文字まで合成した完成イメージで、確定時は再描画しません。
候補画像は ``candidate_ttl_seconds``（既定 3600 秒）で消えます。

配置・配色・題名色は選ばせません。写真は常に標準の構図（題は上、明細は下）で
生成するので、後から配置を変えると題が被写体の上へ移動します。配色は日付と罫線の
2 箇所だけで、題名色は描画側が写真の明るさから決めます。どれも利用者に選ばせると、
選んだ見た目と完成品が食い違うか、可読性の判断を押し付けることになります。

候補を作るだけでは課金も回数消費も起きません。回数は BFF が確定時だけ数えます。
ただしステップ 1 の背景候補だけは、AI が有効なときに画像生成 API を呼びます。
そのため flyer サービス内で 1 端末・1 時間あたり ``ai_candidate_max_per_hour``
（既定 3 枚）に制限し、応答の ``source`` と ``ai_remaining`` で残りを返します。
上限に達したときと生成に失敗したときは、テーマ色で描いたサンプル紙面
（``source`` は ``placeholder``）で 200 を返します。

ステップ 1: 背景
~~~~~~~~~~~~~~~~

``POST /api/v1/flyers/candidates``

``POST /api/v1/flyers/generate`` と同じ項目に ``count``（1〜16、既定 1）を足して送ります。
背景タイルが返ります。``kind`` は ``background`` です。
画面は 1 枚ずつ出し、気に入らなければ作り直させます（``count`` は 1）。

``target_generation``（例: ``"20代から40代"``、50 文字まで）を送ると、想定する
参加者をプロンプトの文脈に足します。値が変われば人物・衣装・光の当て方の指示も
変わるので、同じ催しでも背景の雰囲気が寄ります。人物を描くときは、日本の地域の
催しの参加者として（東アジアの顔立ちと普段着で）描かせます。

``layout_id`` は描画の互換のために受け取りますが、常に ``classic`` として扱います。
``template_id`` はステップ 2 で 3 種を焼き直すまでの仮の書体です。
``count`` は何枚作るかだけで、プロンプトには渡しません。

応答の各候補には ``source``（``ai`` / ``placeholder`` / ``upload``）と
``ai_remaining``（AI で作れる残り枚数。背景のステップだけ）が付きます。
一覧の ``ai_fallback`` は、AI を設定しているのに 1 枚も作れず代替背景へ落ちた
ときに ``true`` です。上限に達した場合も含みます。画面はこれを見て、理由を
利用者に伝えます。

ステップ 2: 紙面の性格
~~~~~~~~~~~~~~~~~~~~~~

``POST /api/v1/flyers/candidates/{candidate_id}/types``

本文は不要です。親候補（背景）の画像をそのまま使い、3 種の紙面の性格
（静けさ／やわらかさ／にぎやかさ）の完成イメージを描きます。3 枚は同じ紙・
同じ差し色・同じ格子で、書体・寄せ・面の濃さだけが違います。``semantic_theme`` に
合う 1 枚は ``recommended`` が ``true`` になります。

画像生成も LLM も呼びません。親候補の ``context`` と背景バイト列を使い回すので、
何度焼き直しても課金は増えません。AI で作った背景と、アップロードした写真の
どちらからでも呼べます。

.. code-block:: json

   {
     "candidates": [
       {
         "candidate_id": "0f6a...",
         "kind": "type",
         "label": "静けさ",
         "description": "明朝で中央に組む。余白を広く取り、罫線は短く。",
         "image_url": "/api/v1/flyers/candidates/0f6a...",
         "template_id": "style_1_bar_stylish",
         "layout_id": "classic",
         "palette_id": "theme",
         "accent_color": "#8B2635",
         "overlay_alpha": 0.55,
         "recommended": true
       }
     ]
   }

候補画像を取得する
~~~~~~~~~~~~~~~~~~

``GET /api/v1/flyers/candidates/{candidate_id}``

応答は ``image/jpeg`` です。ブラウザはこのサービスへ直接届かないため、
通常は BFF の ``/api/v1/flyers/candidates/{id}`` が中継します。

チラシを生成する
----------------

``POST /api/v1/flyers/generate``

.. code-block:: json

   {
     "title": "ジャズの夜",
     "event_date": "2026年11月15日(日)",
     "event_time": "19:00〜22:00 (開場 18:30)",
     "price": "3,000円 (1ドリンク付)",
     "location": "Jazz Bar MOON",
     "rain_policy": "雨天決行",
     "capacity": "先着15名",
     "semantic_theme": "neon",
     "target_generation": "20代から40代",
     "template_id": "style_1_bar_stylish",
     "layout_id": "classic",
     "title_color": null,
     "candidate_id": "0f6a..."
   }

``semantic_theme`` は任意です。指定すると、そのテーマの英語の方向付け
（``design_direction``）を LLM のユーザー JSON に足し、背景の雰囲気を告知ページと
揃えます。候補は ``modern-slate`` / ``enterprise-clean`` / ``parchment`` /
``neo-brutalism`` / ``neon`` / ``washi`` / ``sage`` / ``candy`` / ``dusk`` です。
省略したときの出力は従来と同じです。

``title_color`` も任意です。``#RRGGBB`` を渡すと題名をその色で描きます。
省略（``null``）すると、見出しの群を格子に切り、**最も条件の悪いセル**で墨か白かを
選びます。暗い写真で墨を置くと題名が沈むため、既定は自動です。平均色は使いません
（明るい空と暗い服が混ざると「白で足りる」と誤判定し、白い題が空の上に残ります）。
最悪セルが 4.5:1 に届かないときは、文字ではなく地の側へ半透明の幕を敷いて寄せます。
日付・時刻も題と同じ幕に乗るので、明細だけが写真に沈むことはありません。

``layout_id`` は描画の互換のために受け取りますが、常に ``classic`` として扱います。

``candidate_id`` を付けると、その候補の完成画像をそのまま保存して返します。
文字合成も背景生成もしません。``candidate_id`` を省くと、同じ入力項目から生成します
（API 単体の動作確認用で、画面は使いません）。

成功時の本体は次の形です。

.. code-block:: json

   {
     "status": "success",
     "generation_id": "8f1c....",
     "image_url": "/api/v1/flyers/8f1c...."
   }

``status`` は ``success`` または ``fallback_used`` です。タイトルなどの文字列は、検証の前に前後の空白を除き、改行を空白へ置き換えます。文字数は置換後の値で数えます。

文字数の上限は、催し名 40、開催日 30、開催時間 30、費用 30、場所 60、定員 20 です。催し名は 2 文字以上、場所は 2 文字以上です。

画像を取得する
--------------

``GET /api/v1/flyers/{flyer_id}``

``flyer_id`` は UUID です。応答は ``image/jpeg`` です。UUID でない識別子は 422、期限切れか未作成の ID は 404 です。

エラー
------

.. list-table::
   :header-rows: 1
   :widths: 34 10 28 28

   * - 条件
     - HTTP
     - error_code
     - 利用者向けメッセージ
   * - 入力の型や文字数が不正
     - 422
     - ``INVALID_INPUT``
     - 入力内容を確認してください（文字数超過など）
   * - 候補が無い、または期限切れ
     - 404
     - ``CANDIDATE_EXPIRED``
     - 候補の有効期限が切れました。選び直してください。
   * - LLM の障害、構造化出力の失敗
     - 503
     - ``LLM_SERVICE_UNAVAILABLE``
     - システム混雑のため処理を開始できませんでした。再試行してください
   * - フォントまたは文字合成の失敗
     - 500
     - ``RENDER_FAILURE``
     - 画像の文字合成に失敗しました。管理者に問い合わせてください

画像生成 API のタイムアウトは、この表のエラーにはしません。静的背景で合成し、200 と ``fallback_used`` を返します。

回数制限はこのサービスに持たせません。Next.js の BFF がイベント単位
（``flyer_generation_logs``。公開前の新規作成だけは下書き単位）で数えます。プロキシ経由では送信元 IP が
``127.0.0.1`` に潰れて全員が同じ枠を共有してしまうためです。
例外はステップ 1 の AI 背景候補で、課金が候補の段階で起きるため、このサービスが
端末ごとの枚数（プロセス内メモリ）を持ちます。
