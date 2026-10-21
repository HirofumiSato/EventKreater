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

画面は「タイプ → 背景 → 文字配置 → 配色」の 4 ステップで候補を選びます。
候補はすべて文字まで合成した完成イメージで、確定時は再描画しません。
候補画像は ``candidate_ttl_seconds``（既定 3600 秒）で消えます。

候補を作るだけでは課金も回数消費も起きません。回数は BFF が確定時だけ数えます。

ステップ 1: タイプ
~~~~~~~~~~~~~~~~~~

``POST /api/v1/flyers/candidates/types``

``POST /api/v1/flyers/generate`` と同じ 7 項目を送ります。``template_id`` と
``layout_id`` は無視され、3 テンプレート分の完成イメージが返ります。

.. code-block:: json

   {
     "candidates": [
       {
         "candidate_id": "0f6a...",
         "kind": "type",
         "label": "バー・スタイリッシュ",
         "description": "暗い背景に明朝体。夜のイベント向け",
         "image_url": "/api/v1/flyers/candidates/0f6a...",
         "template_id": "style_1_bar_stylish",
         "layout_id": "classic",
         "palette_id": "gold",
         "accent_color": "#F59E0B",
         "overlay_alpha": 0.55
       }
     ]
   }

ステップ 2: 背景
~~~~~~~~~~~~~~~~

``POST /api/v1/flyers/candidates``

7 項目に ``template_id`` と ``count``（1〜16、既定 8）を足して送ります。
選んだタイプの背景タイルが返ります。``kind`` は ``background`` です。

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
``kind`` は ``palette``、``palette_id`` は ``gold`` / ``mono`` / ``neon`` /
``earth`` です。

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
     "template_id": "style_1_bar_stylish",
     "layout_id": "classic",
     "candidate_id": "0f6a..."
   }

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

回数制限はこのサービスに持たせません。Next.js の BFF が下書き単位
（``flyer_generation_logs``）で数えます。プロキシ経由では送信元 IP が
``127.0.0.1`` に潰れて全員が同じ枠を共有してしまうためです。
