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
   * - ``test_veil_reaches_readability_with_paper_colour``
     - 紙色のベールが必要な不透明度だけ濃くなり、4.5 に届く
   * - ``test_edge_variance_separates_flat_color_from_noise``
     - 単色は閾値未満、ランダム画素は閾値以上
   * - ``test_fit_to_scale_keeps_titles_inside_the_content_box``
     - ``JAZZ`` と「あ」40 字が幅 888、高さ 480、3 行以内、目盛りの段に載る
   * - ``test_larger_space_allows_a_larger_step``
     - タイトルに許す高さが大きいほど、選ばれる段が大きい
   * - ``test_solid_background_renders_portrait_canvas``
     - 3 テンプレートとも 1080×1528 の JPEG で、コントラスト 4.5 以上
   * - ``test_extreme_titles_render_inside_the_page``
     - 短いタイトルは 1 行、40 字は 3 行以内。いずれも安全域の内側
   * - ``test_high_frequency_background_is_veiled_until_readable``
     - ノイズ背景でもベールで 4.5 に届き、縁取りは使わない
   * - ``test_invalid_background_raises_rendering_error``
     - 画像でないバイト列は ``RenderingError``
   * - ``test_renderer_modules_do_not_reference_external_apis``
     - レンダラーのソースに ``openai``、``httpx``、``requests`` が無い
   * - ``test_title_breaks_at_a_meaning_boundary_not_one_character``
     - 「焚火とシチューを囲む / 夕べ」に分かれ、1 文字だけの行を残さない
   * - ``test_short_title_stays_on_one_line_with_tracking``
     - 10 文字以下は 1 行のまま、字間が 6 px 開く
   * - ``test_hanging_is_off_for_centred_paper``
     - 中央寄せの紙面ではぶら下げない
   * - ``test_ink_mass_separates_the_three_tiles``
     - 墨の被覆率が 静けさ < 8%、にぎやかさ > 25%
   * - ``test_a_dark_photo_gets_a_white_title``
     - 暗い写真では自動で白い題名になり、4.5 以上
   * - ``test_a_bright_photo_keeps_the_ink_title``
     - 明るい写真では墨のまま。色を選び直さない
   * - ``test_a_chosen_white_title_darkens_the_ground_instead_of_the_type``
     - 白を選ぶと文字は白のまま、地の側が暗くなる
   * - ``test_a_chosen_colour_that_cannot_be_read_is_moved_to_the_ink_side``
     - 地に近い色はベールでは救えず、色を寄せて ``title_color_adjusted`` が立つ
   * - ``test_resolve_title_color_follows_the_ground``
     - 自動は地の明度で墨か白、指定色は動かさない
   * - ``test_metadata_records_the_chosen_scale_step``
     - ``RenderMetadata.title_font_size`` が目盛りの段と一致する
   * - ``test_detail_text_stays_dark_on_the_translucent_band``
     - 暗い写真の上でも帯の明細は墨のまま。白へ押し上げられない
   * - ``test_the_band_lets_the_background_through``
     - 地が明るいほど帯も明るい。帯は写真を透かす
   * - ``test_the_surface_alpha_is_reported``
     - ``RenderMetadata.overlay_alpha`` が ``design.SURFACE_ALPHA`` の実値

紙面の計画
----------

ファイルは ``tests/test_poster_plan.py`` です。``build_poster_plan`` は画像もフォントも
触らないので、目盛りと縦のリズムを Pillow なしで検証します。

.. list-table::
   :header-rows: 1
   :widths: 48 52

   * - テスト
     - 期待
   * - ``test_every_size_comes_from_the_scale``
     - すべてのスロットの文字サイズが目盛りに含まれる
   * - ``test_every_vertical_position_sits_on_the_8px_baseline``
     - すべての y が 8 の倍数
   * - ``test_text_stays_inside_the_safe_area``
     - 文字は上下 128 px の安全域の内側
   * - ``test_the_accent_is_used_for_exactly_one_text_slot``
     - 差し色の文字は eyebrow の 1 スロットだけ
   * - ``test_the_three_tiles_share_one_grid``
     - 3 種で本文の格子と左右の余白が同一
   * - ``test_the_title_is_the_largest_text_on_the_page``
     - タイトルが紙面で最も大きい
   * - ``test_meta_is_smaller_than_the_title_and_larger_than_the_note``
     - 時刻はタイトルより小さく、note より大きい
   * - ``test_facts_carry_labels_instead_of_icons``
     - 会場 / 参加費 / 定員のラベルがある
   * - ``test_two_column_facts_put_the_value_on_the_right``
     - 2 列の変奏では値が右寄せ
   * - ``test_slots_do_not_overlap``
     - スロット同士が重ならない
   * - ``test_layouts_only_move_the_stack``
     - 4 配置で動くのは群の起点だけ
   * - ``test_bottom_stack_sits_lower_than_top_stack``
     - 下寄せは上寄せより下にある
   * - ``test_the_ink_surface_covers_the_details``
     - 墨の面が明細を覆う。時刻は見出しの群にあり、面の外
   * - ``test_the_date_and_the_time_sit_in_the_same_group``
     - 日付と時刻が同じ群で、時刻がタイトルの上
   * - ``test_the_time_is_larger_than_the_date_and_smaller_than_the_title``
     - 時刻は日付より大きく、タイトルより小さい
   * - ``test_a_chosen_title_colour_reaches_the_slot``
     - 選んだ色がタイトルのスロットに届く
   * - ``test_the_title_colour_is_automatic_by_default``
     - 未指定は墨を仮に置き、描画時に決める
   * - ``test_the_quiet_tile_has_no_plate``
     - 静けさには面が無い
   * - ``test_a_slot_area_is_a_rectangle_and_the_box_is_not``
     - 詳細のスロットは見出しの群の内側ではない。``area`` は (x1, y1, x2, y2)
   * - ``test_no_icons_pills_or_panels_are_drawn``
     - 描画関数にアイコン・ピル・パネルが無い
   * - ``test_accent_of_a_dark_theme_is_still_readable``
     - 暗いテーマの差し色も 4.5 以上
   * - ``test_neon_yellow_is_darkened_for_a_light_paper``
     - 黄は紙に対して墨側へ寄る
   * - ``test_the_surface_steps_are_ordered_by_darkness``
     - paper < band < ink の順に暗い
  * - ``test_an_iso_date_is_written_in_japanese``
     - ``2026-11-14`` は ``2026年11月14日（土）`` になる
  * - ``test_a_poster_plan_never_prints_an_iso_date``
     - ISO を渡しても eyebrow は日本語の日付
  * - ``test_a_date_that_is_not_iso_is_left_alone``
     - 整形済みの日付と実在しない日付は書き換えない

紙の地
------

ファイルは ``tests/test_paper_ground.py`` です。ステップ 1 の 3 枚が 1 枚の紙を
共有することと、写真らしさを作らないことを検証します。

.. list-table::
   :header-rows: 1
   :widths: 48 52

   * - テスト
     - 期待
   * - ``test_paper_matches_the_canvas``
     - 1080×1528 の PNG
   * - ``test_same_theme_paints_the_same_bytes``
     - 同じテーマなら同一バイト列
   * - ``test_step_one_shares_one_paper_across_the_three_tiles``
     - 3 種が同じ紙を使う
   * - ``test_tones_go_dark_as_the_index_grows``
     - 濃さの番号が増えるほど暗い
   * - ``test_paper_has_no_photo_texture``
     - ぼけ玉も偽の水平線も無い
   * - ``test_themes_keep_their_own_papers``
     - テーマごとに紙の色が変わる

タイトル色の選択肢
------------------

ファイルは ``tests/test_title_colors.py`` です。4 通りは並び順を固定し、墨と差し色が
紙に対して 4.5:1 を満たすことを確かめます。

.. list-table::
   :header-rows: 1
   :widths: 48 52

   * - テスト
     - 期待
   * - ``test_four_choices_start_with_automatic``
     - ``auto`` / ``ink`` / ``white`` / ``accent`` の順で、先頭の色は ``None``
   * - ``test_ink_and_accent_stay_readable_on_the_paper``
     - 3 種 × テーマの全組み合わせで 4.5 以上
   * - ``test_unknown_ids_fall_back_to_automatic``
     - 未知の ID は自動へ落とす

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
