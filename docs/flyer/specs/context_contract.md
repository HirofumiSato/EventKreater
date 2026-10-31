# チラシ生成コンテクストの契約

## この文書の役割

画面の入力が、どの項目としてチラシ生成サービスへ渡り、どこで使われるかを 1 枚に固定する。背景画像を作る LLM と、文字を焼き込む決定論レンダラーは別のものなので、「プロンプトに効く項目」と「描画だけで使う項目」を混ぜないことが要点になる。

正はコードである。対応がずれたら、この表とコードの両方を同じ PR で直す。

- 画面の型: `src/modules/events/types.ts` の `EventFormValues`
- 画面 → BFF: `src/modules/flyers/lib/form.ts` の `buildFlyerFormPayload`
- BFF の検証: `src/lib/schemas.ts` の `GenerateFlyerSchema`
- BFF → サービス: `src/modules/flyers/lib/flyer.ts` の `toFlyerPayload`
- サービスの型: `services/flyer/src/domain/models.py` の `FlyerGenerationRequest`
- プロンプトへ渡す項目: `services/flyer/src/domain/prompt_payload.py` の `_CONTEXT_KEYS`
- 題から催しの型を作る: `services/flyer/src/domain/visual_hints.py`
- 画像直前の指示: `services/flyer/src/domain/layout_prompts.py`

## 対応表

消費先は 5 つに分かれる。

- **プロンプト**: LLM が `image_prompt_en` を書く材料になる（`build_prompt_payload`）
- **描画**: レンダラーが画像へ文字として焼き込む（LLM には渡しても描画はさせない）
- **余白**: 画像生成の直前に、文字用の平らな面を空けさせる指示になる
- **落とす**: リクエストには載るが、プロンプトにも描画にも使わない

| 画面の項目 | BFF の変換 | サービス | プロンプト | 描画 |
| --- | --- | --- | --- | --- |
| `title` | そのまま | `title` | 題材・感情の核を 1 つの被写体へ翻訳させる | チラシの見出し |
| `schedules[0].eventDate` | `eventDate` | `event_date` | 季節（11月なら秋）を推論させる | 開催日 |
| `schedules[0].startTime` / `endTime` | `composeEventTime` | `event_time` | 時間帯（19:00 なら夜）を推論させる | 開催時間 |
| `pricePlans` | `flyerPriceLabel`（30 文字以内） | `price` | 価格帯から規模と層を推論させる。文字は描かせない | 費用 |
| `venueName` / `city` / `location` | `flyerLocationLabel`（60 文字以内） | `location` | 会場の型（`setting_family`）を決め、屋内・屋外を判断させる | 開催場所 |
| `rainPolicy` | `RAIN_POLICY_LABELS` | `rain_policy` | 屋内開催なら屋内、雨天決行なら屋外可として扱わせる | 雨天時の案内 |
| `capacity` | `flyerCapacityLabel`（`先着15名`、20 文字を超えたら null） | `capacity` | 規模（少人数か大箱か）を推論させる | 定員 |
| `targetGeneration` | `trim()`、空なら null | `target_generation` | 読者層に合わせて人物・衣装・熱量を寄せる。家族向けは大人と子どもを一緒に描く | 使わない |
| `themeId` | `null` は未指定 | `semantic_theme` | 値そのものと `design_direction`（配色と光だけの英語）を対で渡す | 配色・文字色・サンプル紙面の地 |
| （画面で選ぶ）`templateId` | そのまま | `template_id` | 紙面の性格を `paper_character`（静けさ・やわらかさ・にぎやかさ）として渡し、**地の静けさだけ**を決めさせる。構図と場面は指定しない | 書体・揃え・保護レイヤーの形 |
| （固定）`layoutId` | 常に `classic` | `layout_id` | 渡さない。構図は `composition_hint` が 1 通りに固定する | 文字ブロックの座標 |
| `title`（サービスが抽出） | 変換しない | `activity_families` / `motif_families` / `setting_family` / `people_policy` / `lighting_family` / `energy_family` / `title_nouns` | 題の語を役割の型へ写す。人が居るときは活気の型も決める。辞書に無い語は原文のまま渡す | 使わない |

送らない項目と、その理由。

| 画面の項目 | 理由 |
| --- | --- |
| `organizerDisplayName` | チラシに主催者名を描かない。公開ページの表示だけに使う |
| `rsvpDeadline` | チラシの描画対象ではない。募集締切は告知ページが持つ |
| `status` | 下書き・公開などの運用状態で、絵柄に影響しない |
| `flyerAssetId` | 既存チラシへの参照。生成の入力ではない |
| `postalCode` / `prefecture` / `town` / `addressLine` / `building` | 画面上の住所は `venueName` と `city` に畳んで `location` へ送る |
| `count`（BFF が足す） | 何枚作るかという操作パラメータ。`_CONTEXT_KEYS` に無いのでプロンプトへは渡らない |
| `layoutId` / `paletteId` / `titleColor` | 画面が選ばない（配置は `classic`、配色はテーマ、題名色は描画側が決める）。`layoutId` は描画の互換のために受け取るが、プロンプトへは渡さない |

## 被写体の優先順位

背景の絵柄は、次の順で決める。上ほど強い。下が上の被写体を置き換えてはいけない。

| 順 | 材料 | 効かせ方 |
| --- | --- | --- |
| 1 | `activity_families` / `motif_families` / `energy_family` | 活動と行事の装飾を AND で残し、人が居るときは盛り上がりの頂点として描く。落とさない・別の静物へ言い換えない |
| 2 | `title` / `title_nouns` | 固有語を残す。複合題は AND。辞書外の語は LLM が同じスロットへ分類する |
| 3 | `setting_family` / `target_generation` / `location` / `event_date` / `event_time` | 会場・人物・規模・季節・光を足す。活動を変えない |
| 4 | `semantic_theme` / `design_direction` | 配色・色温度・光だけ。場面も空の色も変えない |
| 5 | `paper_character` | 地の静けさだけ。構図と場面は変えない |

型は **小道具を固定しない**。活動は「身体の公演」「食」のような種類で持ち、
クリスマスツリー、鍋、ライブハウスの内装といった具体物は、題の語を読んだ LLM が
`image_prompt_en` で決める。具体物を契約にすると、料理教室が公演空間になったり、
盆踊りが室内のバンドシーンになったりする。

`setting_family` は場所の語から決め、無ければ活動の既定を使う。公園のヨガは
公園のまま（野外）で、室内の公演空間へ引っ越さない。会場の固有名は描かせない。

`motif_families` は会場を決めない。`クリスマス ごはん会` は holiday × food であり、
公演空間ではない。`クリスマス ダンスパフォーマンス` は holiday × body_performance
であり、公演空間になる。差は活動の型だけである。

`visual_hints` は画面の項目ではない。題から `src/domain/visual_hints.py` が作る。
辞書はデモ催しと対象用途の語彙に限り、未知の題は `title_nouns` として原文のまま
LLM へ渡す。画像モデルへ渡すのは英語の型制約だけである（日本語を渡すと
文字として描かれる恐れがある）。辞書に何も無い題では画像プロンプトの型の行を
足さず、LLM の解釈に任せる。

`target_generation` は、居る人の年代と熱量を寄せるだけである。`people_policy` が
`absent` の催しへ人を足さない。家族向けの催しで対象世代が空でも、「おやこ」「親子」
が題にあれば `people_policy` が `required` になる。人が居るときは、正面の顔・
識別できる顔・クローズアップを避け、後ろ姿・3/4・横顔・シルエットで写す。
横顔までは許し、カメラへ顔を向けさせない。

`energy_family` は、人が居るときだけ決める盛り上がりの頂点である。値は 5 つで、
`crowd_peak`（満杯のフロアと挙がった手）、`dance_peak`（今風のポップスや
ヒップホップで動くフロア）、`game_peak`（勝った瞬間の歓声）、
`celebration_peak`（ケーキ・拍手・クラッカー）、`shared_toast`（グラスを上げ、
皿を回す）。決め方は 3 段で、まず `people_policy` が `absent` なら決めない。次に
題の語（`誕生日`・`ボードゲーム` など）を見て、無ければ活動の既定を使う。
`ヨガ`・`ピラティス`・`瞑想` のような静かな語を含む身体の活動には付けない。
`バレエ`・`フラメンコ`・`舞踊`・`盆踊り` のような舞台の舞踊は、クラブのフロアではなく
客席が拍手する舞台の制約へ差し替える。多色のビームは `lighting_family` が夜の公演を
指すときだけ語り、昼の屋外フェスへは持ち込まない。この型は `energy_family` として
LLM へ渡り、`must_depict_hint` の先頭行にも英語の制約として並ぶ。


## 画像のジオメトリ

`image_prompt_en` が「中央 85% に被写体を寄せろ」と言うのは、生成した画像がそのまま A4 にならないためである。

| 段階 | `gpt-image-2.5` 系（既定） | `dall-e-3` |
| --- | --- | --- |
| 要求サイズ | 1024 x 1536（2:3） | 1024 x 1792（4:7） |
| 幅 1080 へ拡大 | 1080 x 1620 | 1080 x 1890 |
| A4 縦へ中央切り抜き | 1080 x 1528 | 1080 x 1528 |
| 上下の欠落 | 各 46px（合計 5.7%） | 各 181px（合計 19.2%） |

`9:16` という引数は比率ではなく「縦長で頼む」の合図で、実際のサイズは `IMAGE_SIZE` 設定が決める。`1:1` と `16:9` だけは明示指定を優先する。切り抜きは `_cover()` が行い、letterbox は入れない（A4 目いっぱいに敷く）。

この表が崩れると、`CROP_SAFE_AREA_HINT` の 85% という数字の根拠も崩れる。サイズや切り抜き方を変えるときは、`layout_prompts.py` の定数とこの表を同時に直す。

## 画面項目を増やす・変えるときの手順

上から順に触る。途中を飛ばすと、型は通るのにプロンプトへ届かない（または届きすぎる）状態になる。

1. `src/modules/events/types.ts` の `EventFormValues`
2. `src/modules/flyers/lib/form.ts` の `FlyerFormPayload` と `buildFlyerFormPayload`（表示用の文字列へ寄せるなら `src/lib/serializers.ts` の変換関数を足す）
3. `src/lib/schemas.ts` の `GenerateFlyerSchema`（文字数上限は画面の入力上限と揃える）
4. `src/modules/flyers/lib/flyer.ts` の `toFlyerPayload`（スネークケースへ寄せる）
5. `services/flyer/src/domain/models.py` の `FlyerGenerationRequest`
6. `services/flyer/src/domain/prompt_payload.py` の `_CONTEXT_KEYS` と、必要なら `src/adapters/prompt_engine/openai_prompt_engine.py` の `# How to read the event data`（仕様書 `implementation_spec.md` の同ブロックも同時に直す。バイト一致をテストが検査している）
7. 描画で使うなら `services/flyer/src/adapters/renderer/` と `src/domain/models.py` の描画用の型
8. この表
9. テスト（`services/flyer/tests/test_prompt_context.py`、`tests/unit/event-preview.test.ts`）
10. `npm run docs:gen` / `npm run docs:counts` / `npm run docs:links`。画面の見た目が変わるなら `npm run mock:sync`

## この契約で塞いだ穴

- `target_generation` がサービスまで届いておらず、読者層がプロンプトに効いていなかった
- 題が「感情の核を 1 つの被写体へ」とだけ指示され、ハロウィン おやこマルシェが無関係な静物へ畳まれていた
- `style_2_warm_earth` のような ID が LLM に風景の指定として読まれ、題より強く効いていた
- テーマの `design_direction` が配色ではなく場面を指示し、被写体と競合していた
- `human faces close-up` が既定の除外語で、家族向けの催しから人物が消えていた
- 画面は 50 文字、サービスは 40 文字で、長い入力をすると 400 になっていた
- `model_dump_json()` の素通しで `count` まで LLM へ渡っていた
- 候補を経ない `POST /api/v1/flyers/generate` だけ、余白と切り抜きの指示が無かった
- `IMAGE_SIZE` が原価見積りにしか効いておらず、実際のリクエストとずれていた
- 辞書が「語 → 具体的な小道具」だったため、行事名だけの題が静物へ畳まれ、活動と会場が落ちていた
- `ライブ` がバンドシーンに直結し、ダンス・DJ・朗読のライブまで同じ絵になっていた
- 場所が会場の型にならず、公演なのにリビングのような既定へ流れていた
- 対象世代があると、物が主体の催しにも群衆が足されていた
- 人が居るときの写し方が無く、正面の顔や集合写真になりやすかった
- 人が出る催しなのに、空の会場・立ったままの人・整列した集合写真になっていた（DJ・ダンス・ボードゲーム・誕生日の活気を型で導出するようにした）
