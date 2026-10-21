Pydantic
========

目的
----

API の入出力、LLM の構造化出力、レンダラーが記録する描画メタデータを、同じスキーマで検証します。バージョンは v2 です。

使い方
------

モデルは ``src/domain/models.py`` にあります。

* :class:`src.domain.models.FlyerGenerationRequest` は生成リクエストです。必須文字列は検証前に前後空白を除き、改行を空白へ置換します。文字数制限はこの置換後の値にかかります。
* :class:`src.domain.models.LLMGenerationContext` は OpenAI の ``response_format`` にそのまま渡します。アクセント色は ``#RRGGBB``、遮光の不透明度は 0.2 以上 0.7 以下です。
* :class:`src.domain.models.FlyerGenerationResponse` が HTTP の成功レスポンスです。``status`` は ``success`` または ``fallback_used`` です。

リクエストは未知フィールドを無視します。LLM の出力モデルは未知フィールドを拒否します。

Tips
----

* サニタイズは ``mode="before"`` の ``field_validator`` です。``after`` にすると、最大文字数の判定がトリム前の文字列に対して行われます。
* 雨天時の対応は日本語の列挙値です（例: ``雨天決行``）。省略時の既定値は雨天決行です。
* 空の定員文字列は ``None`` になります。描画ではその行を出しません。
* ``model_dump(mode="json")`` は列挙を値の文字列にします。テストの POST 本体はこの形を使います。
* LLM へ渡す JSON は ``model_dump_json(ensure_ascii=False)`` です。日本語を ``\u`` エスケープせず、ユーザーメッセージとして隔離します。
