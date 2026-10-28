OpenAI
======

目的
----

催し情報を、文字を描かせない英語の背景プロンプトとスタイルパラメータに変換し、そのプロンプトで背景画像を得ます。

使い方
------

* テキストは ``src/adapters/prompt_engine/openai_prompt_engine.py`` です。モデルは ``gpt-4o-mini``、呼び出しは ``client.beta.chat.completions.parse``、``response_format`` は :class:`src.domain.models.LLMGenerationContext` です。
* 画像は ``src/adapters/image_generator/dalle_image_generator.py`` です。モデルは ``gpt-image-2.5-flare``、画質は ``low``、縦長のサイズは ``IMAGE_SIZE``（既定 ``1024x1536``）、1:1 は ``1024x1024`` です。``gpt-image-2.5`` 系は A4 縦（1080×1528）へ切り抜いたときの欠落が小さく、縦長の ``dall-e-3``（``1024x1792``）より安く済みます。``gpt-image-1`` は 2026-10-23 に API が停止したため、既定にしていません。``OPENAI_IMAGE_MODEL=dall-e-3`` にすれば従来の組み合わせでも動きます（サイズは ``1024x1792`` へ寄せます）。

システムプロンプトは :data:`src.adapters.prompt_engine.openai_prompt_engine.SYSTEM_PROMPT` で、実装仕様書 2.2 と一致することをテストが確認します。``# Deliverable`` 節で「文字の無い背景を作る」ことと、2:3 で描いて A4 縦（1080×1528）へ中央切り抜きされる事実を伝えます。生成した画像はそのまま A4 にならないため、被写体を中央 85% へ寄せる指示をプロンプト本文と画像直前の両方で出します（:doc:`../specs/context_contract` の「画像のジオメトリ」）。

要求サイズは ``IMAGE_SIZE``（既定 ``1024x1536``）が決め、実際のリクエストと原価の見積りが同じ値を使います。``1:1`` と ``16:9`` を明示したときだけ、その比率のサイズを優先します。切り抜きの欠落は ``gpt-image-2.5`` 系で上下 5.7%、``dall-e-3``（``1024x1792``）で 19.2% です。

Tips
----

* 利用者の文章はシステムプロンプトへ連結しません。ユーザーメッセージの JSON に隔離します。
* DALL-E 3 にはネガティブプロンプト欄がありません。除外語は本文末尾の ``Avoid:`` に連結し、全体を 3900 文字で切ります。
* 画像生成の総予算は 25 秒、試行は最大 2 回です。失敗時は静的背景へ委譲し、HTTP は 200 の ``fallback_used`` です。LLM の失敗は委譲せず 503 です。
* 開発中に課金したくないときは ``OPENAI_API_KEY`` を外します。組み立てがモックへ切り替わります。
* 価格は ``src/domain/pricing.py`` の表で見積もります。``gpt-image-2.5`` 系はトークン課金で 1 枚あたりの定価が無いため、公式ガイドの代表サイズの換算値（``1024x1536`` / ``low`` = 約 $0.0047）を切り上げて $0.005 として持っています。``OPENAI_IMAGE_MODEL`` を変えるときは同じ表と ``tests/test_cost_budget.py`` を更新してください。表に無い組み合わせは安全側（$0.25）で見積もるため、更新を忘れると予算ガードが生成前に打ち切ります。
* 本番クライアントをテストで差し替えるときは、``OpenAIPromptEngine`` の ``transport`` と ``DalleImageGenerator`` の ``client`` を使います。SDK の実通信は不要です。
