# Phase 1 用プロンプト
@detailed_design_spec.md の「第2章 モジュール構造」および「第3章 クラス詳細設計」に基づき、以下のモジュールを作成してください。外部通信の実装は含めず、純粋なインターフェースとデータモデルのみを定義します。

【作成対象ファイル】
1. `src/domain/models.py`
   - `@implementation_spec.md` の 2.1 に記載された `TemplateId`, `RainPolicy`, `FlyerGenerationRequest`
   - `LLMGenerationContext`, `RenderMetadata`, `FlyerAsset` の Pydantic v2 モデル
2. `src/domain/exceptions.py`
   - `FlyerAppException` を基底とする例外クラス階層（`InputValidationError`, `APIQuotaExceededError`, `ImageGenerationTimeoutError`, `RenderingError`）
3. `src/ports/prompt_engine_port.py`
   - `PromptEnginePort(ABC)` の抽象基底クラス（`generate_prompt_context` メソッド）
4. `src/ports/image_generator_port.py`
   - `ImageGeneratorPort(ABC)` の抽象基底クラス（`generate_background` メソッド）
5. `src/ports/renderer_port.py`
   - `FlyerRendererPort(ABC)` の抽象基底クラス（`render_flyer` メソッド）

【検証要件】
- 循環参照が存在しないこと。
- Pydanticのフィールドバリデーション（文字数制限、サニタイズ）が正しく設定されていること。