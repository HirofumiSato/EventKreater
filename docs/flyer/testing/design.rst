テスト設計
==========

ケースは、仕様の境界と失敗の分岐から切ります。実装ファイルは ``tests/`` です。入力の共通データは ``tests/support.py`` に置きます。

切り方
------

* **境界値。** タイトルは 1 文字（未満）、2 文字（最小）、40 文字（最大）、41 文字（超過）。定員は 21 文字で拒否し、空白だけなら ``None`` です。
* **同値分割。** テンプレート 3 種は同じキャンバス規則に属するので、描画の煙試験は 3 種すべて、極端なタイトルは代表の 1 種です。タイトルの字間は 10 文字未満とそれ以上で分けます。
* **分岐。** 画像生成の失敗は 200 かつ ``fallback_used``、言語モデルの失敗は 503、描画失敗は 500、入力不正は 422、回数超過は 429 です。
* **状態。** 保存直後のファイルは TTL 内なら残り、更新時刻が過去のファイルは消えます。ディスク空きが閾値未満なら、古い JPEG から消します。

ドメイン
--------

ファイルは ``tests/test_domain.py`` です。

.. list-table::
   :header-rows: 1
   :widths: 46 54

   * - テスト
     - 期待
   * - ``test_title_strips_whitespace_and_newlines``
     - 前後空白と改行が除かれ、雨天時の対応は既定の雨天決行
   * - ``test_blank_capacity_becomes_none``
     - 空白だけの定員は ``None``
   * - ``test_length_limits_reject_overflow``
     - 短すぎるタイトル、41 文字、1 文字の場所、21 文字の定員を拒否
   * - ``test_llm_context_rejects_invalid_color_and_alpha``
     - ``#RRGGBB`` でない色と、0.2 未満の不透明度を拒否
   * - ``test_exception_hierarchy_matches_error_matrix``
     - 422 / 429 / 503 / 500 と ``error_code`` が例外クラスに一致

レンダラー
----------

ファイルは ``tests/test_renderer.py`` です。背景は単色、または粗いノイズです。ネットワークは使いません。

.. list-table::
   :header-rows: 1
   :widths: 48 52

   * - テスト
     - 期待
   * - ``test_relative_luminance_and_contrast_ratio``
     - 黒 0、白 1、白黒の比 21。4.49 は保護が必要、4.5 は不要
   * - ``test_backdrop_is_required_only_when_contrast_is_short``
     - 白地に白文字なら黒の板。不透明度 0.5 では 4.5 未満、採用値は 0.65
   * - ``test_edge_variance_separates_flat_color_from_noise``
     - 単色は閾値未満、ランダム画素は閾値以上
   * - ``test_calculator_keeps_extreme_titles_inside_the_title_box``
     - ``JAZZ`` と「あ」40 字が幅 920、高さ 336、3 行以内、44 px 以上
   * - ``test_solid_background_renders_portrait_canvas``
     - 3 テンプレートとも 1080×1528 の JPEG で、コントラスト 4.5 以上
   * - ``test_extreme_titles_render_inside_zone_b``
     - 短いタイトルは字間 15。40 字は字間 0。いずれも枠内
   * - ``test_high_frequency_background_still_renders``
     - ノイズ背景でも描画でき、縁取りフラグが立つ
   * - ``test_invalid_background_raises_rendering_error``
     - 画像でないバイト列は ``RenderingError``
   * - ``test_renderer_modules_do_not_reference_external_apis``
     - レンダラーのソースに ``openai``、``httpx``、``requests`` が無い
   * - ``test_title_breaks_at_the_meaning_boundary``
     - 3 テンプレートとも「焚火とシチューを囲む / 夕べ」に分かれ、ぶら下げになる
   * - ``test_short_title_stays_on_one_line``
     - 1 行に収まるタイトルは改行しない
   * - ``test_tail_is_not_left_alone_when_the_line_is_one_pixel_short``
     - 幅が 1 px 足りないときも「べ」だけを最終行に残さない
   * - ``test_hanging_line_sits_at_the_block_right_edge``
     - 中央寄せと左寄せのどちらも、最終行の右端がブロック右端に一致する
   * - ``test_hanging_title_is_recorded_in_metadata``
     - ``RenderMetadata.title_hanging`` に真が入る

タイトルの意味改行
------------------

ファイルは ``tests/test_title_composition.py`` です。フォントを使わず、分割の候補だけを検証します。

.. list-table::
   :header-rows: 1
   :widths: 48 52

   * - テスト
     - 期待
   * - ``test_tail_word_is_cut_off_before_it``
     - 「焚火とシチューの / 夕べ」。末尾の語を最終行へ残す
   * - ``test_long_title_keeps_the_tail_word_together``
     - 長い題でも「夕べ」を 1 語のまま最終行に置く
   * - ``test_one_character_line_never_appears``
     - どの候補にも 1 文字だけの行が無い
   * - ``test_small_kana_and_punctuation_do_not_start_a_line``
     - 小書き仮名、句読点、閉じ括弧から行を始めない
   * - ``test_katakana_word_is_not_split_at_the_small_kana``
     - 「ジャズセッシ / ョン」のような切れ目を作らない
   * - ``test_explicit_space_is_a_break_and_is_trimmed``
     - 入力された空白を区切りに使い、前後の空白は落とす

アダプター
----------

ファイルは ``tests/test_adapters.py`` です。OpenAI のクライアントはテスト内の偽物です。システムプロンプトは ``docs/flyer/specs/implementation_spec.md`` の 2.2 と全文比較します。

.. list-table::
   :header-rows: 1
   :widths: 48 52

   * - テスト
     - 期待
   * - ``test_blank_api_key_selects_mocks``
     - 空白のキーは未設定扱いで、モック実装になる
   * - ``test_configured_api_key_selects_openai_adapters``
     - キーがあると OpenAI 実装になり、失敗先は静的背景
   * - ``test_openai_prompt_engine_sends_spec_prompt_and_user_json``
     - システム文は仕様どおり、ユーザー文は入力 JSON
   * - ``test_openai_prompt_engine_wraps_transport_errors``
     - 通信失敗は ``LLMContextGenerationError``
   * - ``test_structured_transport_reads_parsed_model``
     - モデルは ``gpt-4o-mini``、応答形式は ``LLMGenerationContext``
   * - ``test_structured_transport_rejects_refusal_and_sdk_errors``
     - 拒否と SDK 例外のどちらも LLM エラー
   * - ``test_compose_image_prompt_includes_negative_prompt``
     - 除外語を本文へ連結し、3900 文字で切る
   * - ``test_dalle_size_mapping``
     - 9:16 は 1024×1792、1:1 は 1024×1024、16:9 は 1792×1024
   * - ``test_dalle_retries_then_succeeds``
     - 1 回失敗したあと 2 回目で成功し、フォールバックしない
   * - ``test_dalle_timeout_delegates_to_static_fallback``
     - 予算超過で静的背景になり、1080×1528 のファイルが残る
   * - ``test_download_image_rejects_non_image``
     - HTML 応答は画像生成エラー

API とストレージ
----------------

ファイルは ``tests/test_api_integration.py`` です。``TestClient`` がアプリを起動します。別プロセスの ``uvicorn`` は使いません。

.. list-table::
   :header-rows: 1
   :widths: 48 52

   * - テスト
     - 期待
   * - ``test_generate_then_download_portrait_jpeg``
     - ``/health`` と ``/docs`` が 200。生成の ``image_url`` から 1080×1528 の JPEG を取得できる
   * - ``test_invalid_input_returns_422``
     - 短すぎるタイトルは ``INVALID_INPUT`` と決まった日本語
   * - ``test_rate_limit_returns_429``
     - 上限 1 のとき、2 回目は ``RATE_LIMIT``
   * - ``test_llm_failure_returns_503``
     - 言語モデルの失敗は ``LLM_SERVICE_UNAVAILABLE``
   * - ``test_image_timeout_uses_static_fallback``
     - 画像のタイムアウト後も 200 で、``status`` は ``fallback_used``
   * - ``test_render_failure_returns_500``
     - フォント失敗は ``RENDER_FAILURE``
   * - ``test_missing_and_invalid_flyer_ids``
     - 未知の UUID は 404。UUID でない ID は 422
   * - ``test_storage_ttl_and_atomic_write``
     - 保存後に一時ファイルは残らない。期限切れだけ消え、メモは残る
   * - ``test_emergency_purge_drops_oldest_files_when_disk_is_low``
     - 空き 5% の差し替えで、古い JPEG から削除される
   * - ``test_settings_ttl_matches_detailed_design``
     - TTL の既定は 3600 秒

ケースを足すとき
----------------

1. 仕様の数値か分岐を一つ決める。
2. 外部通信が要るなら、ポートかクライアントをテスト内で差し替える。
3. 期待値は仕様の数のまま書く。実装に合わせて期待を下げない。
4. 関数名は ``test_`` で始め、確認している条件が名前から分かるようにする。
