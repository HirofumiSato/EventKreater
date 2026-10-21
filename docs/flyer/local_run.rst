ローカルでの実行
================

自分の PC 上で API を起動し、ブラウザからチラシを 1 枚作ります。コマンドは、``requirements.txt`` があるプロジェクトルートで実行します。

準備
----

Python 3.11 以上を使います。依存ライブラリを入れます。

.. code-block:: powershell

   python -m pip install -r requirements.txt

``OPENAI_API_KEY`` は空のままで構いません。キーが無いときは、有料 API を呼ばず、固定のプロンプトとグラデーション背景で画像を作ります。

サーバーを起動する
------------------

.. code-block:: powershell

   python -m uvicorn src.main:app --reload

``src.main:app`` は ``src/main.py`` の変数 ``app`` です。``--reload`` は、ソースを保存するたびにサーバーを再起動する開発用の指定です。止めるときは、そのターミナルで Ctrl+C を押します。

起動できたらブラウザで次を開きます。

* 死活確認: http://127.0.0.1:8000/health
* 試験用画面（Swagger UI）: http://127.0.0.1:8000/docs

``/health`` の表示が ``{"status":"ok"}`` なら、サーバーは要求を受け付けています。

ブラウザから 1 枚作る
----------------------

``/docs`` の ``POST /api/v1/flyers/generate`` を開き、Try it out に次を貼って Execute します。ボタンの位置が分からないときは :doc:`swagger` を先に読んでください。

.. code-block:: json

   {
     "title": "ジャズの夜",
     "event_date": "2026年11月15日(日)",
     "event_time": "19:00〜22:00",
     "price": "3,000円",
     "location": "Jazz Bar MOON",
     "template_id": "style_1_bar_stylish"
   }

応答の ``status`` は ``success``、``image_url`` は ``/api/v1/flyers/（UUID）`` です。そのパスを ``http://127.0.0.1:8000`` のうしろにつなぐと、JPEG が表示されます。完成ファイルの実体は ``src/static/tmp/{uuid}.jpg`` です。

PowerShell から同じ依頼を送る場合は、別のターミナルで次を実行します。サーバーのターミナルはそのままにしておきます。

.. code-block:: text

   curl.exe -X POST http://127.0.0.1:8000/api/v1/flyers/generate -H "Content-Type: application/json" -d "{\"title\":\"ジャズの夜\",\"event_date\":\"2026年11月15日(日)\",\"event_time\":\"19:00-22:00\",\"price\":\"3,000円\",\"location\":\"Jazz Bar MOON\",\"template_id\":\"style_1_bar_stylish\"}"

OpenAI を使うとき
-----------------

キーをプロセスの環境変数に入れてから、同じ起動コマンドを打ちます。すでに起動中のサーバーには効かないので、一度止めてから起動し直します。

.. code-block:: powershell

   $env:OPENAI_API_KEY = "sk-..."
   python -m uvicorn src.main:app --reload

この場合、プロンプトは ``gpt-4o-mini``、背景は DALL-E 3 です。画像生成には最大で約 25 秒かかります。失敗したときは静的背景で合成し、``status`` が ``fallback_used`` になります。

うまく起動しないとき
--------------------

* ``src`` が見つからない、と出るときは、カレントディレクトリがプロジェクトルートではありません。``requirements.txt`` が見える場所へ移動してから実行します。
* 8000 番が使用中なら ``python -m uvicorn src.main:app --reload --port 8765`` とし、ブラウザの URL のポートも 8765 に変えます。
* ``uvicorn`` というコマンドが無いときは、上記のとおり ``python -m uvicorn`` を使います。
* 文字の入った画像が欲しいだけなら、API キーは不要です。キーが空でも ``/docs`` から生成できます。
