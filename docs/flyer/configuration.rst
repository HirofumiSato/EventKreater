設定
====

設定は :class:`src.infrastructure.config.Settings` です。環境変数名はフィールド名の大文字です（例: ``OPENAI_API_KEY``）。空文字の API キーは未設定と同じです。

.. list-table::
   :header-rows: 1
   :widths: 40 18 42

   * - フィールド
     - 初期値
     - 意味
   * - ``openai_api_key``
     - なし
     - 無いときはモックアダプター
   * - ``openai_text_model``
     - ``gpt-4o-mini``
     - 構造化出力のモデル
   * - ``openai_image_model``
     - ``gpt-image-2.5-flare``
     - 背景画像のモデル。``gpt-image-1`` は 2026-10-23 に API が停止したため使わない
   * - ``image_quality``
     - ``low``
     - 背景の画質。``gpt-image-2.5`` 系は low/medium/high/xhigh/max、``dall-e-3`` は standard/hd
   * - ``image_size``
     - ``1024x1536``
     - 要求する背景のサイズ。実際のリクエストと原価の見積りの両方に使い、モデルに無い値はクライアントが寄せる。``1:1`` と ``16:9`` だけは指定を優先する
   * - ``ai_candidates_enabled``
     - なし
     - AI の背景候補を出すか。未設定は API キーの有無に従う。``1`` / ``0`` で固定
   * - ``ai_candidate_max_per_hour``
     - 3
     - 1 端末・1 時間に作る AI 背景の枚数（初回 1 ＋ 作り直し 2）
   * - ``usd_jpy_rate``
     - 200
     - 原価の見積りに使う為替。円安側に置き、安く見積もらない
   * - ``max_cost_jpy_per_request``
     - 9.5
     - 1 回の生成で守る原価の上限（円）
   * - ``image_generation_timeout_seconds``
     - 25
     - 画像生成の総予算（秒）。``high`` 以上にすると 1 枚で超えやすく、静的背景へ落ちる
   * - ``image_generation_max_attempts``
     - 2
     - 予算内の試行回数
   * - ``llm_timeout_seconds``
     - 20
     - LLM クライアントのタイムアウト
   * - ``storage_dir``
     - ``src/static/tmp``
     - 完成 JPEG の保存先
   * - ``fallback_dir``
     - ``src/static/default_backgrounds``
     - テンプレート別の静的背景
   * - ``ttl_seconds``
     - 3600
     - 一時ファイルを消すまでの秒数
   * - ``cleanup_interval_seconds``
     - 600
     - 掃除タスクの間隔
   * - ``disk_free_ratio_threshold``
     - 0.10
     - 空き容量がこの比率未満なら古いファイルから強制削除

AI の背景候補は、``OPENAI_API_KEY`` があり ``AI_CANDIDATES_ENABLED`` が未設定か ``1`` のとき有効です。``0`` を入れるとキーがあってもグラデーションだけで返します。上限の枚数はプロセス内メモリで数えるため、再起動すると戻ります。

``docker compose`` では ``OPENAI_TEXT_MODEL`` / ``OPENAI_IMAGE_MODEL`` / ``IMAGE_QUALITY`` / ``IMAGE_SIZE`` を ``${VAR:-}`` で透過します。空文字は上表の初期値へ戻るので、既定値を compose と Python の二重に持たなくて済みます。``OPENAI_IMAGE_MODEL`` を変えたときは ``src/domain/pricing.py`` の表にも同じモデルの行を足してください。無いと安全側の $0.25 で見積もられ、``max_cost_jpy_per_request`` に当たって生成前に打ち切られます。

``IMAGE_QUALITY`` は 1 枚の見積りがそのまま上限に効きます。``low`` は 1.0 円、``medium`` は 2.2 円、``high`` は 8.4 円で、``high`` は 1 リクエスト 1 枚までです。``xhigh``（14.8 円）と ``max``（33 円）は 1 枚で上限 9.5 円を超えるため、``max_cost_jpy_per_request`` を上げるまで AI 背景は作られません。

一時ファイルは ``{uuid}.jpg`` です。書き込みは一時名へ出したあと ``os.replace`` で差し替えます。プロセス起動中、10 分ごとに更新時刻が TTL を超えたファイルを消します。ディスクの空きが 10% を下回った場合は、TTL を待たず古い JPEG から捨てます。

静的背景のファイル名は ``{template_id}_default.png`` です。ファイルが無いときは、テンプレートごとのグラデーションをその場で作り、同じ名前で保存します。
