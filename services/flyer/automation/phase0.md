# Phase 0 用プロンプト
以下の要件に従い、プロジェクトルートに `.cursorrules` ファイルを作成してください。

【プロジェクト概要】
小規模店舗オーナー向けAIチラシ自動生成システム（FastAPI + Pillow + OpenAI API）。
アーキテクチャは Ports & Adapters（Hexagonal Architecture）を厳格に適用します。

【コーディング規約・制約事項】
1. 言語・型: Python 3.11+。すべての関数・メソッドに厳密な型ヒント（Type Hints）を付与し、`mypy --strict` をパスする設計にすること。
2. ドキュメント準拠: 設計の詳細は常に `@implementation_spec.md` および `@detailed_design_spec.md` を正とすること。仕様にない勝手な機能追加（YAGNI違反）を禁止する。
3. 責務分離: 決定論的レンダリング（Pillow）の中に外部API通信（OpenAI等）のコードを絶対に混入させないこと。
4. エラー処理: 例外を握りつぶさないこと。独自のカスタム例外階層（`FlyerAppException` 派生）を使用すること。
5. テスト駆動: ロジック実装時は必ず対応する `pytest` テストコードを `tests/` に作成すること。

`.cursorrules` の出力のみを行ってください。