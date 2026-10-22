# AIチラシ自動生成

小規模店舗やイベント主催者向けの Web API です。催しの事実情報とテンプレートから、縦長（9:16）の告知画像を返します。背景は言語モデルと画像生成、文字は Pillow が描きます。

## 必要環境

Python 3.11 以上。

```powershell
python -m pip install -r requirements.txt
```

## API の起動

プロジェクトルートで実行します。

```powershell
python -m uvicorn src.main:app --reload
```

- 死活確認: http://127.0.0.1:8000/health
- Swagger UI: http://127.0.0.1:8000/docs

`OPENAI_API_KEY` が未設定のときは、モックのプロンプトとグラデーション背景で生成します。

## ドキュメント（Sphinx）

設計、HTTP API、文字合成、設定、導入ライブラリの説明は Sphinx にあります。原稿はリポジトリの `docs/flyer/` にあり、HTML を生成してブラウザで開きます。コマンドはリポジトリ直下で実行します。

```powershell
python -m sphinx -b html docs/flyer docs/flyer/_build/html
start docs\flyer\_build\html\index.html
```

リポジトリ直下の `npm run docs` は、全章をまとめて `docs/_build/html/` に出力します。チラシの章だけを確認したいときは上のコマンドを使ってください。生成物は Git の対象外です。

## 導入ライブラリ

詳細は各リンク先です。Sphinx では「導入ライブラリ」のページにも同じ表があります。

| ライブラリ | 目的 | 使い方概要 |
| :--- | :--- | :--- |
| [FastAPI](../../docs/flyer/libraries/fastapi.rst) | 生成とダウンロードの HTTP API を公開する | `src/api/routes.py` にルートを書き、`create_app` で組み立てる。例外は JSON の `error_code` に変換する |
| [Uvicorn](../../docs/flyer/libraries/uvicorn.rst) | FastAPI を ASGI サーバーとして起動する | プロジェクトルートで `python -m uvicorn src.main:app --reload` を実行し、`/health` と `/docs` を開く |
| [Pydantic](../../docs/flyer/libraries/pydantic.rst) | 入出力と LLM の構造化出力を同じスキーマで検証する | `src/domain/models.py` のモデルをリクエスト、`response_format`、描画メタデータに使う |
| [pydantic-settings](../../docs/flyer/libraries/pydantic_settings.rst) | API キーや TTL などの設定を環境変数から読む | `Settings` を参照する。キーが空ならモックアダプターになる |
| [Pillow](../../docs/flyer/libraries/pillow.rst) | 背景の上に文字と遮光を決定論的に描く | `src/adapters/renderer/` が 1080×1920 の JPEG を返す。この層から外部 API は呼ばない |
| [OpenAI](../../docs/flyer/libraries/openai.rst) | 背景用プロンプトの構造化と DALL-E 3 による画像取得を行う | `gpt-4o-mini` の `beta.chat.completions.parse` と `dall-e-3` を、キーがあるときだけ使う |
| [HTTPX](../../docs/flyer/libraries/httpx.rst) | 生成画像の URL からバイト列を取得する | `download_image` が残り時間をタイムアウトにして取得する。テストは `MockTransport` を渡す |
| [pytest](../../docs/flyer/libraries/pytest.rst) | 外部 API なしで単体テストと結合テストを実行する | プロジェクトルートで `python -m pytest tests/ -v` を実行する |
| [mypy](../../docs/flyer/libraries/mypy.rst) | `src` の型ヒントを厳密に検査する | `python -m mypy` を実行する（`mypy.ini` が strict 設定）。テストは対象外 |
| [Sphinx](../../docs/flyer/libraries/sphinx.rst) | ガイドと API リファレンスを HTML にする | `python -m sphinx -b html docs/flyer docs/flyer/_build/html` のあと `docs/flyer/_build/html/index.html` を開く |
| [sphinx-rtd-theme](../../docs/flyer/libraries/sphinx_rtd_theme.rst) | HTML を Read the Docs のレイアウトで表示する | `docs/flyer/conf.py` の `html_theme` に指定する。文書の言語設定とは独立している |

## テストと型チェック

```powershell
python -m pytest tests/ -v
python -m mypy
```
