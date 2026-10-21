OpenAI
======

目的
----

催し情報を、文字を描かせない英語の背景プロンプトとスタイルパラメータに変換し、そのプロンプトで背景画像を得ます。

使い方
------

* テキストは ``src/adapters/prompt_engine/openai_prompt_engine.py`` です。モデルは ``gpt-4o-mini``、呼び出しは ``client.beta.chat.completions.parse``、``response_format`` は :class:`src.domain.models.LLMGenerationContext` です。
* 画像は ``src/adapters/image_generator/dalle_image_generator.py`` です。モデルは ``dall-e-3``、9:16 のサイズは ``1024x1792``、1:1 は ``1024x1024`` です。

システムプロンプトは :data:`src.adapters.prompt_engine.openai_prompt_engine.SYSTEM_PROMPT` で、実装仕様書 2.2 と一致することをテストが確認します。

Tips
----

* 利用者の文章はシステムプロンプトへ連結しません。ユーザーメッセージの JSON に隔離します。
* DALL-E 3 にはネガティブプロンプト欄がありません。除外語は本文末尾の ``Avoid:`` に連結し、全体を 3900 文字で切ります。
* 画像生成の総予算は 25 秒、試行は最大 2 回です。失敗時は静的背景へ委譲し、HTTP は 200 の ``fallback_used`` です。LLM の失敗は委譲せず 503 です。
* 開発中に課金したくないときは ``OPENAI_API_KEY`` を外します。組み立てがモックへ切り替わります。
* 本番クライアントをテストで差し替えるときは、``OpenAIPromptEngine`` の ``transport`` と ``DalleImageGenerator`` の ``client`` を使います。SDK の実通信は不要です。
