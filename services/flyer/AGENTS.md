# services/flyer

イベント主催者向けの AI チラシ生成 API です。FastAPI + Pillow + OpenAI。
Next.js 本体から HTTP で呼ばれる独立サービスで、DB には触れません。

## 真実の源

パスはリポジトリルート基準です。

| 対象 | 文書 |
| --- | --- |
| 描画・アルゴリズム・データ契約・座標 | `docs/flyer/specs/implementation_spec.md` |
| 構造・クラス・シーケンス・例外・ライフサイクル | `docs/flyer/specs/detailed_design_spec.md` |
| Next.js 側との API 契約 | `docs/backend_api_implementation_spec.md` |

- 仕様に無い機能追加（YAGNI 違反）を禁止します。
- `automation/phase*.md` は完了済みの作業指示です。履歴として残していますが参照しないでください。従うと実装済みのものを再実装します。
- 仕様とコードが食い違ったら、コードを直すか仕様を直すかを同じ PR で決めます。

## アーキテクチャ（Ports & Adapters）

- 依存の向きは `adapters` / `infrastructure` → `ports` → `domain` の一方向です。`domain` と `ports` から外部 SDK・HTTP クライアント・ファイルシステムを import しません。
- 組み立ては `src/adapters/wiring.py` と `src/main.py` だけで行います。
- 決定論的な描画（Pillow）に外部 API 通信を混ぜません。LLM・画像生成と文字合成は直列パイプラインで疎結合にします。
- ユースケースは `src/ports/` の抽象だけを受け取ります。候補の保存先は `CandidateStorePort` で、実装は `src/infrastructure/storage/local_candidate_store.py` です。

## 言語・型

- Python 3.11 以上（CI は 3.12）。
- すべての関数・メソッドに型ヒントを付けます。`Any` の安易な使用と `# type: ignore` を禁止します（`src` は現在 0 件。`tests` の 8 件は許容）。
- 型検査は `services/flyer/mypy.ini` の strict 設定です。対象は `src` だけで、CI の `typecheck` ジョブが `python -m mypy` を実行します。
- `app.state` のように型が `Any` になる境界では、`typing.cast` で組み立て時の型に戻します。`# type: ignore` で黙らせません。

## エラー処理

- 例外を握りつぶしません。`except Exception: pass` と裸の `except:` を禁止します。
- 基底は `src/domain/exceptions.py` の `FlyerAppException` です。
- 画像生成の失敗は 5xx を返さず、静的フォールバック背景で 200 と `status: fallback_used` を返します。
- LLM の失敗は握りつぶさず `LLMContextGenerationError` として伝播させます。
- ログに原因を残し、クライアント向け文言は詳細設計のエラーマトリクスに従います。

## 実装境界

- 基準解像度は 1080×1920（9:16）。アップロード画像もサーバー側でこの比率に cover 正規化します。受け入れる形式は JPEG / PNG / WEBP のみです。
- 文字配置は実装仕様のゾーン座標に従います。タイトルのフォントサイズは二分探索で矩形内に収束させます（`src/adapters/renderer/layout_calculator.py`）。
- コントラストは WCAG 2.1 AA（4.5:1 以上）を合格基準とします（`WCAG_AA_CONTRAST`）。
- フロントエンドでレイアウトを再計算しません。返すのは描画済みビットマップだけです。
- 候補（candidate）は文字まで合成済みの完成イメージです。確定時に再描画しません。
- 利用枠（quota）は Next.js 側の責務です。このサービスは関知しません。

## テスト

- ロジックを実装したら `tests/` に対応する pytest を書きます。共通ヘルパーは `tests/support.py` です。
- テストを通すために閾値を緩めたり、テストを削除・コメントアウトしたりしません。仕様に合わせて実装を直します。
- 外部 API はポートをモックし、レンダラーとドメインは決定論的に検証します。
- 実行は `python -m pytest -q`（CI と同じ）。描画に日本語フォントが要るため、フォントが無いと `FontRenderError` で落ちます。

## 実行

```powershell
python -m pip install -r requirements.txt
python -m uvicorn src.main:app --reload
python -m pytest -q
python -m mypy
```

`OPENAI_API_KEY` が空のときはモックのプロンプトとグラデーション背景で生成します。
