# Phase 3 用プロンプト
@detailed_design_spec.md の「3.2 プロンプト生成モジュール」「3.3 画像生成モジュール」に基づき、外部API連携アダプターを実装してください。

【作成対象ファイル】
1. `src/adapters/prompt_engine/openai_prompt_engine.py`
   - `PromptEnginePort` を実装。OpenAI `gpt-4o-mini` の Structured Outputs (`beta.chat.completions.parse`) を使用
   - システムプロンプトは `@implementation_spec.md` の 2.2 を完全再現
2. `src/adapters/image_generator/dalle_image_generator.py`
   - `ImageGeneratorPort` を実装。OpenAI DALL-E 3 APIを呼び出し、URLから画像バイト列を取得
   - 25秒のタイムアウト処理、リトライロジック、および失敗時の `StaticFallbackImageGenerator` への委譲処理
3. `src/adapters/image_generator/mock_image_generator.py`
   - 開発コスト削減のため、APIを消費せずローカルでグラデーション背景を生成する `MockImageGenerator`
4. `src/adapters/prompt_engine/mock_prompt_engine.py`
   - 固定の `LLMGenerationContext` を返すモック

【検証要件】
- `OPENAI_API_KEY` が未設定の場合でも、モックアダプターに切り替えて単体テスト（`tests/test_adapters.py`）が実行できる構成にすること。