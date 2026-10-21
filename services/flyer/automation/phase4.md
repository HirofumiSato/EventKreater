# Phase 4 用プロンプト
@detailed_design_spec.md の「第4章 処理シーケンス」「第5章 例外処理・フォールバックマトリクス」「第6章 リソース・ファイルライフサイクル設計」に基づき、Webアプリケーション全体を統合してください。

【作成対象ファイル】
1. `src/usecases/generate_flyer_usecase.py`
   - 各 Port をDI（依存性注入）で受け取り、シーケンス通りに入力解釈→背景取得→文字合成を実行するオーケストレーター
2. `src/infrastructure/storage/local_file_storage.py`
   - 生成画像の保存、TTL（24時間）経過ファイルの自動クリーンアップタスク（APSchedulerまたはバックグラウンドタスク）
3. `src/api/routes.py` および `src/main.py`
   - `POST /api/v1/flyers/generate` エンドポイント
   - `GET /api/v1/flyers/{flyer_id}` 画像ダウンロードエンドポイント
   - グローバル例外ハンドラー（ドメイン例外を適切なHTTPステータスコードに変換）
4. `tests/test_api_integration.py`
   - FastAPI `TestClient` を用いた結合テスト（モック環境下での生成〜ダウンロードフロー検証）

【完了条件】
- `pytest` がすべてグリーンになること。
- `uvicorn src.main:app --reload` で起動し、Swagger UI (`/docs`) から疎通確認ができる状態になること。