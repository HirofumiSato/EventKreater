# Phase 2 用プロンプト
@implementation_spec.md の「第3章 決定論的文字合成・幾何学レイアウトエンジン仕様」および @detailed_design_spec.md に基づき、Pillowを用いたレンダリングモジュールを実装してください。

【作成対象ファイル】
1. `src/adapters/renderer/layout_calculator.py`
   - 仕様書 3.3 の二分探索フォントスケーリング（`calculate_optimal_font_and_lines`）
   - 仕様書 3.4 の相対輝度およびコントラスト比計算（WCAG 2.1 AA 準拠、局所バックドロップ判定）
2. `src/adapters/renderer/pillow_renderer.py`
   - `FlyerRendererPort` を実装した `PillowFlyerRenderer` クラス
   - 基準解像度 1080×1920 (9:16) キャンバスへの背景配置、オーバーレイ描画、グリッド（Zone A〜E）に沿った文字レンダリング
   - テンプレートごとのスタイル分岐（Style 1: 中央揃え/ダーク、Style 2: 左揃え/カード、Style 3: グリッド/ポップ）
3. `tests/test_renderer.py`
   - 単色背景画像を用いたダミー描画テスト
   - 極端に長いタイトル（40文字）および極端に短いタイトル（4文字）でもエラーなく画像が生成され、指定矩形領域内に収まることを検証するユニットテスト

【フォントの扱い】
- テスト実行用に、OS標準の日本語フォント（macOSなら `Hiragino Sans` や `AppleGothic`、Linuxなら `Noto Sans CJK JP`）へフォールバックする仕組みを入れてください。