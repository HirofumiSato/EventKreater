# テーマを 1 つ足すときの合格条件

公開ページのセマンティックテーマ（`data-semantic-theme`）を増やすときの手順と、
人手で確かめる項目をまとめます。機械で止められるものは
`tests/unit/semantic-theme-quality.test.ts` と
`services/flyer/tests/test_theme_parity.py` が先に落とします。
このページは、その上で**目で見ないと分からない**ものだけを扱います。

## 14 つのテーマと用途

| 用途グループ | ID | ラベル | 書体 | 主な装飾 | 向く催し |
| --- | --- | --- | --- | --- | --- |
| 落ち着き | `parchment` | 羊皮紙 | Kaisei Decol（明朝デコ） | 墨 1px の罫線 + 3px の左バー、二重線のカード上辺、18px の点粒地紋 | 読み物・日記のような告知 |
| 落ち着き | `washi` | 和紙と藍 | システム明朝 | 藍 1px の罫線、左バーなし、縦繊維 + 横織りの地紋、2px 角のチップ | 占い・季節の催し・手紙のような告知 |
| 明るい | `enterprise-clean` | クリーン | 表示書体 | 細い罫線、カード上辺 2px の差し色、24px の薄いグリッド、8px 角のボタン | 相談・勉強会・どんな催しにも |
| 明るい | `sage` | 余白 | 角ゴシック | 罫線なし、2px の左バー、影なし、地紋なし | 読書会・ヨガ・マルシェ |
| 元気 | `neo-brutalism` | 太枠 | Dela Gothic One（極太） | 墨 3px の罫線、カード上辺 3px、角 0、8px のハーフトーン、墨地のアイブロウ | 手づくり・チラシらしい勢い |
| 元気 | `candy` | キャンディ | Yusei Magic（手書き） | 差し色 3px の点線罫線、丸いボタンとチップ、24px の紙吹雪、点線の区切り | タコパ・誕生日・子ども連れ |
| 元気 | `kraft` | クラフト | Yusei Magic（手書き） | テラコッタ 2px の破線罫線、4px 角のチップ、斑点 + 縦繊維、破線の区切り | マルシェ・一日店長・手しごと |
| 夜 | `modern-slate` | 夜のスレート | 表示書体 | 藍 1px の罫線 + 3px の左バー、32px の薄いグリッド、大文字化、8px 角のボタン | 写真を主役にしたライブ |
| 夜 | `neon` | ネオン | 表示書体 | シアン 1px の罫線、24px の薄いグリッド、大文字化、6px 角のボタン、丸いチップ | クラブ・深夜の催し |
| 夜 | `dusk` | 夕暮れ | 角ゴシック | 橙 2px の罫線、カード上辺 2px、下辺の地平線、10px 角のボタン | BBQ・夕方のライブ・ビアガーデン |
| 食 | `tavern` | 店の灯り | システム明朝 | 琥珀 1px の罫線 + 4px の左バー、点線の区切り、8px の木目、4px 角 | バー・食堂・店の催し |
| ステージ | `neon-magenta` | マゼンタのネオン | 表示書体 | 桃紫 2px の罫線、カード上辺 2px、12px の斜線、2px 角、大文字化 | クラブ・アイドル・DJの夜 |
| ステージ | `poster` | ライブポスター | Dela Gothic One（極太） | 朱 4px の罫線、カード上辺 2px、6px のハーフトーン、角 0、朱地のアイブロウ | バンド・DJ・演劇の告知 |
| ステージ | `spotlight` | スポットライト | システム明朝 | クリーム 1px の罫線、`◆` の飾り、16px 角、字間 0.24em のアイブロウ | 演劇・ダンス・舞台の発表 |

「色だけ違うテーマ」は増やしません。近いテーマの検出（後述）が、
地・差し色・角丸・書体・密度・装飾の 6 軸で 4 つ以上一致する組を落とします。
6 軸に広げたあとも基準は 4 つ以上のままです（軸を増やしたぶん、逃げ道は狭くなります）。

## 追加する書体は 3 つ

見出しの声を色とは別に選べるよう、テーマは 3 つの書体のどれかを指します。
書体そのものは `src/components/ui/ThemeTypefaces.tsx` の 1 箇所だけが持ちます。

| 書体 | キー | 使うテーマ | 役割 |
| --- | --- | --- | --- |
| Kaisei Decol | `kaisei` | `parchment` | 羊皮紙のための、少し装飾的な明朝 |
| Dela Gothic One | `dela` | `neo-brutalism` / `poster` | 太枠・ライブポスターのための極太表示 |
| Yusei Magic | `yusei` | `candy` / `kraft` | キャンディ・クラフトのための手書き風 |

- **テーマを選んだ画面だけが読みます。** `SemanticThemeScope` と `ThemePicker` が、
  テーマが有効なときだけ `<link rel="stylesheet">` を出します。テーマ未選択のページは
  追加のフォントファイルを取りに行きません（参加者の初回表示を遅くしないため）。
- **1 つのテーマの書体は 1 本の URL にまとめます。** `themeFontHref(themeId)` が
  `THEME_FONT_FAMILIES` の割り当てを読み、必要な family だけを `display=swap` 付きで並べます。
  書体ごとに `<link>` を分けると、テーマを 1 つ選ぶだけでリクエストが増えます。
- **割り当ての正は `THEME_FONT_FAMILIES`。** テーマの CSS が `"Kaisei Decol"` を指しているのに
  そのテーマが書体を読まない、というずれは品質テストが落とします。

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
| `--st-heading-leading` | `inherit` | 見出しの行間 |
| `--st-heading-transform` | `none` | 見出しの大文字化（`uppercase`） |
| `--st-heading-rule` | `none` | 見出しの下線（`underline 2px ...`） |
| `--st-heading-rule-offset` | `0.42em` | 下線と文字の距離 |
| `--st-body-leading` | `inherit` | 本文の行間 |
| `--st-body-tracking` | `normal` | 本文の字間 |
| `--st-eyebrow-tracking` | `0.12em` | アイブロウの字間 |
| `--st-eyebrow-weight` | `700` | アイブロウの太さ |
| `--st-eyebrow-bg` | `none` | アイブロウの地（札にするテーマだけ塗る） |
| `--st-eyebrow-color` | `var(--st-accent-text)` | アイブロウの文字 |
| `--st-eyebrow-padding` | `0` | アイブロウの余白 |
| `--st-eyebrow-radius` | `0` | アイブロウの角 |
| `--st-eyebrow-transform` | `none` | アイブロウの大文字化 |
| `--st-section-rule` | `枠幅 solid 本文色` | セクション見出しの罫線 |
| `--st-section-lead` | `5px` | セクション見出しの左バー（`0` で消す） |
| `--st-section-lead-color` | `var(--st-accent-primary)` | 左バーの色 |
| `--st-section-ornament` | `none` | セクション見出しの飾り（`"◆"` など） |
| `--st-section-ornament-color` | `var(--st-accent-primary)` | 飾りの色 |
| `--st-divider-style` | `solid` | 一覧・事実の行の区切り線種（`dashed` / `dotted`） |
| `--st-button-radius` | `999px` | ボタン・入力欄の角 |
| `--st-chip-radius` | `999px` | チップの角 |
| `--st-card-top` | `枠幅 solid 枠色` | カード・パネル・カレンダーの上辺 |
| `--st-stack-gap` | `1.25rem` | `.stack` の間隔（密度） |
| `--st-content-width` | `var(--width-content)` | 読み幅（行長） |
| `--st-border-strong` | `color-mix(in srgb, 枠 55%, 補助文字)` | 押せる部品の境界 |

地紋の `--st-surface-image` / `--st-surface-image-size` / `--st-surface-image-repeat` は
テーマだけが持ち、消費側の `var(..., none)` / `var(..., auto)` で受けるため既定値を置きません。
状態色 `--st-danger` / `--st-warning` / `--st-success` も、全テーマが自分の地に合わせて持ちます
（既定値を置くと、書き忘れたテーマがコントラスト試験を通ってしまうため）。

色・書体・密度はトークンだけで表します。`[data-semantic-theme="x"] .card` のような
テーマ固有の規則は書きません（書くと、そのテーマだけ部品の面倒を見ることになり、
新しい部品を足すたびに 14 箇所を直すことになります）。

## 機械が止めるもの

| ゲート | 見ていること | 落ちたとき |
| --- | --- | --- |
| コントラスト | 本文 7:1、補助文字・リンク 4.5:1、押せる部品の境界 3:1（地と面の両方）。待ちの札の地色と文字も 4.5:1 | 色を直す。目分量で薄くしない |
| 網羅性 | 参照したトークンに既定値かフォールバックがある。定義したトークンがどこかで使われている | 既定値を足す。使っていないトークンは消す |
| 任意トークンの既定値 | `.semantic-theme` の `--st-*` 宣言を自動で列挙し、すべてに既定値がある。テーマだけが持つ `--st-*` は、必須・既定値なしの色・フォールバック付きのどれかに分類できる | 既定値を足す。分類できない名前は足さない |
| 書体の分類 | `--st-font-heading` を 極太 / 明朝デコ / 手書き / 明朝 / 表示書体 / 角ゴシック に落とし、Dela Gothic One や Yusei Magic を明朝と数えない | 判定の順を直す。書体名を足すときは判定も足す |
| テーマ固有規則 | `[data-semantic-theme="x"]` が定義ブロックの 1 箇所だけ | トークンで表せないか考える。表せないなら部品側を直す |
| 近接テーマ | 6 軸（地・差し色・角丸・書体・密度・装飾）のうち 4 つ以上が同じ組が無い | 色だけでなく、書体・角・密度・装飾のどれかをずらす |
| シグネチャ | 全テーマが書体トークン 1 つ以上 + 装飾トークン 2 つ以上を持つ。`--st-font-heading` は読み込み済みの 3 書体・システム書体・総称ファミリ・`var(--font)` / `var(--font-display)` だけを指す | CSS にシグネチャを足す。Web フォントを指すなら `THEME_FONT_FAMILIES` にも割り当てる |
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
- 見出しの声（書体・字間・行間・大文字化）がテーマごとに変わり、同じ用途の隣のテーマと見分けられる
- セクション見出しの罫線・左バー・飾り（`◆` など）が出る。`--st-section-lead: 0` のテーマでは帯が残らない
- カード・パネル・カレンダーの上辺に差し色（`--st-card-top`）が出る。細い枠のテーマでも上辺だけ太くならない
- ボタン・入力欄・チップの角（`--st-button-radius` / `--st-chip-radius`）が揃い、ボタンだけ丸くならない
- 地の柄（`--st-surface-image`）が本文の背後でちらつかない。alpha は 0.06 以下
- テーマ未選択のページで追加書体（Kaisei Decol / Dela Gothic One / Yusei Magic）を読まない（DevTools の Network で確認）
- 編集画面の見本（27）と公開ページ（06）で、見出しの書体・罫線・角が一致する
- 印刷（`@media print`）で地を塗らない。地紋も落ちる
- チラシの紙面と色が揃っている（flyer の `theme_look` と同一値）
- 390px で横スクロールが出ない。チップが折り返して 2〜3 行に収まる
- 640px 以上でチップと見本が 2 列になり、見本が入力の流れを切らない

## 新しいテーマを足すときに触るファイル

同じ PR で、次をすべて更新します。

| 種類 | ファイル |
| --- | --- |
| 色・書体・密度 | `src/styles/themes.css` の `[data-semantic-theme="..."]` |
| 追加書体の読み込みと割り当て | `src/components/ui/ThemeTypefaces.tsx`（`THEME_FONT_FAMILIES`） |
| ID・ラベル・説明・用途グループ | `src/lib/semantic-themes.ts` |
| モックの状態 | `scripts/lib/mock-screens.mjs` の `states`（ラベルは TS と一致させる） |
| チラシの色と英語の方向付け | `services/flyer/src/domain/models.py` の `SemanticTheme` / `_THEME_DIRECTIONS` |
| チラシの色の写し | `services/flyer/src/domain/semantic_theme.py` の `_THEME_LOOKS` |
| 一覧の列挙 | `docs/backend_api_implementation_spec.md`、`docs/front_implementation_spec.md`、`docs/flyer/swagger.rst`、`docs/flyer/http_api.rst`、`docs/issues/organizer-profile-appearance.md` |
| このページ | 上の「14 つのテーマと用途」 |
