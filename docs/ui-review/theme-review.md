# テーマを 1 つ足すときの合格条件

公開ページのセマンティックテーマ（`data-semantic-theme`）を増やすときの手順と、
人手で確かめる項目をまとめます。機械で止められるものは
`tests/unit/semantic-theme-quality.test.ts` と
`services/flyer/tests/test_theme_parity.py` が先に落とします。
このページは、その上で**目で見ないと分からない**ものだけを扱います。

## 9 つのテーマと用途

| 用途グループ | ID | ラベル | 向く催し |
| --- | --- | --- | --- |
| 落ち着き | `parchment` | 羊皮紙 | 読み物・日記のような告知 |
| 落ち着き | `washi` | 和紙と藍 | 占い・季節の催し・手紙のような告知 |
| 明るい | `enterprise-clean` | クリーン | 相談・勉強会・どんな催しにも |
| 明るい | `sage` | 余白 | 読書会・ヨガ・マルシェ |
| 元気 | `neo-brutalism` | ネオ・ブルータリズム | 手づくり・チラシらしい勢い |
| 元気 | `candy` | キャンディ | タコパ・誕生日・子ども連れ |
| 夜 | `modern-slate` | 夜のスレート | 写真を主役にしたライブ |
| 夜 | `neon` | ネオン | クラブ・深夜の催し |
| 夜 | `dusk` | 夕暮れ | BBQ・夕方のライブ・ビアガーデン |

「色だけ違うテーマ」は増やしません。近いテーマの検出（後述）が、
地の明るさ・差し色の色相・角丸・書体・密度の 5 軸で 4 つ以上一致する組を落とします。

## トークンの契約

テーマは `src/styles/themes.css` の `[data-semantic-theme="..."]` ブロックだけを持ちます。
部品は書き換えません。**必須**は全テーマが必ず書き、**任意**は変えたい値だけ書きます
（書かなければ `.semantic-theme` の既定値）。

| 必須トークン | 役割 |
| --- | --- |
| `--st-surface-base` | 地 |
| `--st-surface-raised` | カード・パネルの面 |
| `--st-content-primary` | 本文 |
| `--st-content-secondary` | 補足・ラベル |
| `--st-accent-primary` | 差し色 |
| `--st-accent-text` | リンク・小さな見出しの差し色文字 |
| `--st-accent-contrast` | 差し色の上に置く文字 |
| `--st-border-width` | 枠の太さ |
| `--st-border-color` | 枠の色 |
| `--st-radius-base` | 角丸の基準 |
| `--st-shadow-elevation` | 影 |

| 任意トークン | 既定値 | 効く場所 |
| --- | --- | --- |
| `--st-font-heading` | `var(--font-display)` | 見出し・料金・数字の書体 |
| `--st-font-body` | `var(--font)` | 本文の書体 |
| `--st-heading-weight` | `700` | 見出しの太さ |
| `--st-heading-tracking` | `0.01em` | 見出しの字間 |
| `--st-stack-gap` | `1.25rem` | `.stack` の間隔（密度） |
| `--st-content-width` | `var(--width-content)` | 読み幅（行長） |
| `--st-border-strong` | `color-mix(in srgb, 枠 55%, 補助文字)` | 押せる部品の境界 |

色・書体・密度はトークンだけで表します。`[data-semantic-theme="x"] .card` のような
テーマ固有の規則は書きません（書くと、そのテーマだけ部品の面倒を見ることになり、
新しい部品を足すたびに 9 箇所を直すことになります）。

## 機械が止めるもの

| ゲート | 見ていること | 落ちたとき |
| --- | --- | --- |
| コントラスト | 本文 7:1、補助文字・リンク 4.5:1、押せる部品の境界 3:1（地と面の両方）。待ちの札の地色と文字も 4.5:1 | 色を直す。目分量で薄くしない |
| 網羅性 | 参照したトークンに既定値かフォールバックがある。定義したトークンがどこかで使われている | 既定値を足す。使っていないトークンは消す |
| テーマ固有規則 | `[data-semantic-theme="x"]` が定義ブロックの 1 箇所だけ | トークンで表せないか考える。表せないなら部品側を直す |
| 近接テーマ | 5 軸のうち 4 つ以上が同じ組が無い | 色だけでなく、書体・角・密度のどれかをずらす |
| 言語間のずれ | `themes.css` の地・差し色・墨と `_THEME_LOOKS` の `base` / `accent` / `ink` が一致 | 同じ PR で両方直す |

```powershell
npx vitest run tests/unit/semantic-theme-quality.test.ts
cd services/flyer; python -m pytest -q tests/test_theme_parity.py
```

## 目で見る手順

テーマを 1 つ足したら、次の 3 画面を 390px と 1280px で撮ります。

```powershell
npm run db:seed:ui
npm run mock:sync -- --only=06,27,23
```

| 画面 | 見るもの |
| --- | --- |
| 06 主催者のページ（`mock-organizer-public-theme-<id>.html`） | 地・面・差し色・カレンダー・一覧 |
| 06 主催者のページ（未ログイン） | 白塗りの上でも文字が読める |
| 27 プロフィールの編集 | チップ（3 色の丸）と見本が、選ぶ前と後で一致する |
| 23 下書きプレビュー | 編集画面の見本と、公開ページの実物が同じ見た目 |

撮り直したら、`npm run mock:sync`（全体）で 390 / 1280 を取り直し、
`style-guide/**` と `mock-manifest.json` をコミットします（手順は
[mock-sync.md](mock-sync.md)）。

## チェック項目

- カレンダーの短冊（通常・満員・待ち・非表示）の 4 状態が、地の上で読める
- 入力欄（`.input` / `.textarea` / `.select`）の面と文字、案内文が読める
- チップ・バッジ・アラート・ダイアログ・操作バーが地から浮かない（面の明度差が保たれている）
- 罫線の細いテーマでも、押せる部品の境界が 3:1 を満たす
- 地の柄（`--st-surface-image`）が本文の背後でちらつかない。alpha は 0.06 以下
- 印刷（`@media print`）で地を塗らない
- チラシの紙面と色が揃っている（flyer の `theme_look` と同一値）
- 390px で横スクロールが出ない。チップが折り返して 2〜3 行に収まる
- 640px 以上でチップと見本が 2 列になり、見本が入力の流れを切らない

## 新しいテーマを足すときに触るファイル

同じ PR で、次をすべて更新します。

| 種類 | ファイル |
| --- | --- |
| 色・書体・密度 | `src/styles/themes.css` の `[data-semantic-theme="..."]` |
| ID・ラベル・説明・用途グループ | `src/lib/semantic-themes.ts` |
| モックの状態 | `scripts/lib/mock-screens.mjs` の `states`（ラベルは TS と一致させる） |
| チラシの色と英語の方向付け | `services/flyer/src/domain/models.py` の `SemanticTheme` / `_THEME_DIRECTIONS` |
| チラシの色の写し | `services/flyer/src/domain/semantic_theme.py` の `_THEME_LOOKS` |
| 一覧の列挙 | `docs/backend_api_implementation_spec.md`、`docs/front_implementation_spec.md`、`docs/flyer/swagger.rst`、`docs/flyer/http_api.rst`、`docs/issues/organizer-profile-appearance.md` |
| このページ | 上の「9 つのテーマと用途」 |
