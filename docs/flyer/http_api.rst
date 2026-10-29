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

画面は「紙面の性格 → 背景 → 文字配置 → 配色 → タイトル色」の 5 ステップで候補を選びます。
候補はすべて文字まで合成した完成イメージで、確定時は再描画しません。
候補画像は ``candidate_ttl_seconds``（既定 3600 秒）で消えます。

候補を作るだけでは課金も回数消費も起きません。回数は BFF が確定時だけ数えます。
ただしステップ 2 の背景候補だけは、AI が有効なときに画像生成 API を呼びます。
そのため flyer サービス内で 1 端末・1 時間あたり ``ai_candidate_max_per_hour``
（既定 3 枚）に制限し、応答の ``source`` と ``ai_remaining`` で残りを返します。
上限に達したときと生成に失敗したときは、テーマ色で描いたサンプル紙面
（``source`` は ``placeholder``）で 200 を返します。

ステップ 1: 紙面の性格
~~~~~~~~~~~~~~~~~~~~~~

``POST /api/v1/flyers/candidates/types``

``POST /api/v1/flyers/generate`` と同じ 7 項目を送ります。``template_id`` と
``layout_id`` は無視され、3 種の紙面の性格（静けさ／やわらかさ／にぎやかさ）の
完成イメージが返ります。3 枚は同じ紙・同じ差し色・同じ格子で、書体・寄せ・
面の濃さだけが違います。``semantic_theme`` に合う 1 枚は ``recommended`` が
``true`` になります。

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

ステップ 2: 背景
~~~~~~~~~~~~~~~~

``POST /api/v1/flyers/candidates``

7 項目に ``template_id`` と ``count``（1〜16、既定 1）を足して送ります。
選んだ紙面の性格の背景タイルが返ります。``kind`` は ``background`` です。
画面は 1 枚ずつ出し、気に入らなければ作り直させます（``count`` は 1）。

``target_generation``（例: ``"20代から40代"``、50 文字まで）を送ると、想定する
参加者をプロンプトの文脈に足します。値が変われば人物・衣装・光の当て方の指示も
変わるので、同じ催しでも背景の雰囲気が寄ります。``layout_id`` は余白の指示に使い、
ステップ 2 では ``classic``（上下の帯を空け、真ん中に被写体を置く）を渡します。
``count`` は何枚作るかだけで、プロンプトには渡しません。

応答の各候補には ``source``（``ai`` / ``placeholder`` / ``upload``）と
``ai_remaining``（AI で作れる残り枚数。背景のステップだけ）が付きます。
一覧の ``ai_fallback`` は、AI を設定しているのに 1 枚も作れず代替背景へ落ちた
ときに ``true`` です。上限に達した場合も含みます。画面はこれを見て、理由を
利用者に伝えます。

ステップ 3: 文字配置
~~~~~~~~~~~~~~~~~~~~

``POST /api/v1/flyers/candidates/{candidate_id}/layouts``

本文は不要です。親候補の背景をそのまま使い、4 通りの配置を描きます。
``kind`` は ``layout``、``layout_id`` は ``classic`` / ``top_stack`` /
``center_stack`` / ``bottom_stack`` です。

ステップ 4: 配色
~~~~~~~~~~~~~~~~

``POST /api/v1/flyers/candidates/{candidate_id}/palettes``

本文は不要です。親候補の背景と配置をそのまま使い、4 通りの配色を描きます。
``kind`` は ``palette`` です。``semantic_theme`` があるときは ``theme`` /
``theme-soft`` / ``theme-deep`` / ``theme-quiet``（テーマの差し色から作る）で、
無いときは ``gold`` / ``mono`` / ``neon`` / ``earth`` です。どちらも、いま選ばれて
いる色が先頭に来ます。

ステップ 5: タイトル色
~~~~~~~~~~~~~~~~~~~~~~

``POST /api/v1/flyers/candidates/{candidate_id}/title-colors``

本文は不要です。親候補の背景・配置・配色をそのまま使い、題名の色だけを変えた
4 枚を描きます。``kind`` は ``title_color`` で、並びは ``auto``（自動） /
``ink``（墨） / ``white``（白） / ``accent``（差し色）に固定します。先頭が自動なのは、
題名の読みやすさが写真の明るさで変わり、迷ったときに戻せる場所が要るためです。

* ``auto`` の ``title_color`` は ``null`` です。描画時に見出しの群の平均色を測り、
  墨が 4.5:1 を満たせば墨、満たさなければ白を選びます。
* それ以外は ``#RRGGBB`` を返します。``ink`` と ``accent`` は紙に対して
  4.5:1 へ寄せた値です。``white`` は明るい紙でも地の側を暗くして白を保ちます。

各候補には描画に使った ``title_color``（``auto`` なら ``null``）が付きます。

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
省略（``null``）すると、見出しの群の平均色から墨か白を選びます。暗い写真で墨を
置くと題名が沈むため、既定は自動です。選んだ色が地に近くて読めないときは、
文字ではなく地の側を寄せます。

``candidate_id`` を付けると、その候補の完成画像をそのまま保存して返します。
文字合成も背景生成もしません。``candidate_id`` を省くと、7 項目から生成します
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
例外はステップ 2 の AI 背景候補で、課金が候補の段階で起きるため、このサービスが
端末ごとの枚数（プロセス内メモリ）を持ちます。
