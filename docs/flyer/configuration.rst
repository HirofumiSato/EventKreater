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
     - ``dall-e-3``
     - 背景画像のモデル
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
   * - ``rate_limit_max_requests``
     - 3
     - ウィンドウ内の生成回数
   * - ``rate_limit_window_seconds``
     - 3600
     - レート制限の窓

一時ファイルは ``{uuid}.jpg`` です。書き込みは一時名へ出したあと ``os.replace`` で差し替えます。プロセス起動中、10 分ごとに更新時刻が TTL を超えたファイルを消します。ディスクの空きが 10% を下回った場合は、TTL を待たず古い JPEG から捨てます。

静的背景のファイル名は ``{template_id}_default.png`` です。ファイルが無いときは、テンプレートごとのグラデーションをその場で作り、同じ名前で保存します。
