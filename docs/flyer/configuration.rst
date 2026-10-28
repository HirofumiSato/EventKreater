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
     - ``gpt-image-1``
     - 背景画像のモデル
   * - ``image_quality``
     - ``low``
     - 背景の画質。``gpt-image-1`` は low/medium/high、``dall-e-3`` は standard/hd
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
     - 画像生成の総予算（秒）
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

一時ファイルは ``{uuid}.jpg`` です。書き込みは一時名へ出したあと ``os.replace`` で差し替えます。プロセス起動中、10 分ごとに更新時刻が TTL を超えたファイルを消します。ディスクの空きが 10% を下回った場合は、TTL を待たず古い JPEG から捨てます。

静的背景のファイル名は ``{template_id}_default.png`` です。ファイルが無いときは、テンプレートごとのグラデーションをその場で作り、同じ名前で保存します。
