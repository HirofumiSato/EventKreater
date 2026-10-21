生成パイプライン
================

:meth:`src.usecases.generate_flyer_usecase.GenerateFlyerUseCase.execute` が次の順で処理します。

1. **プロンプト解釈。** ``PromptEnginePort.generate_prompt_context`` が :class:`src.domain.models.LLMGenerationContext` を返します。中身は英語の背景プロンプト、除外プロンプト、アクセント色（``#RRGGBB``）、遮光の不透明度（0.2 以上 0.7 以下）です。
2. **背景の取得。** ``ImageGeneratorPort.generate_background`` をアスペクト比 ``9:16`` で呼びます。
3. **文字合成。** ``FlyerRendererPort.render_flyer`` が背景バイト列と入力テキストから JPEG を作ります。
4. **一時保存。** UUID をファイル名にし、``/api/v1/flyers/{id}`` を返します。

画像生成が失敗したとき
----------------------

DALL-E 3 アダプターは呼び出し全体の予算を 25 秒とし、その内側で最大 2 回試します。予算を超えた、または応答が画像でなかった場合は、静的なテンプレート背景へ委譲し ``used_fallback`` を立てます。

ユースケース側でも :class:`src.domain.exceptions.ImageGenerationTimeoutError` と、画像生成中のその他の例外を捕捉します。捕捉したあとは静的背景で合成を続け、HTTP は 200、``status`` は ``fallback_used`` です。利用者に生成失敗の空レスポンスは返しません。

LLM の失敗は捕捉して背景にすり替えません。:class:`src.domain.exceptions.LLMContextGenerationError` のまま API へ上がり、503 になります。

プロンプトの制約
----------------

システムプロンプトは :data:`src.adapters.prompt_engine.openai_prompt_engine.SYSTEM_PROMPT` にあり、実装仕様書 2.2 の文言と一致させています。利用者の入力はシステムメッセージへ混ぜず、ユーザーメッセージの JSON として渡します。

画像プロンプトには、文字・数字・ロゴを描かないことと、テンプレートごとの余白（コピー用の暗い面、柔らかい背景、文字を載せられる低周波の領域）を要求します。DALL-E 3 には独立したネガティブプロンプト欄がないため、除外語は本文の末尾へ連結します。
