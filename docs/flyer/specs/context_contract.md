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
| `venueName` / `city` / `location` | `flyerLocationLabel`（60 文字以内） | `location` | 会場種別（バー、スタジオ、ホール、公園）と屋内・屋外を推論させる | 開催場所 |
| `rainPolicy` | `RAIN_POLICY_LABELS` | `rain_policy` | 屋内開催なら屋内、雨天決行なら屋外可として扱わせる | 雨天時の案内 |
| `capacity` | `flyerCapacityLabel`（`先着15名`、20 文字を超えたら null） | `capacity` | 規模（少人数か大箱か）を推論させる | 定員 |
| `targetGeneration` | `trim()`、空なら null | `target_generation` | 読者層に合わせて人物・衣装・熱量を寄せる | 使わない |
| `themeId` | `null` は未指定 | `semantic_theme` | 値そのものと `design_direction`（英語の方向付け）を対で渡す | 配色の一部 |
| （画面で選ぶ）`templateId` | そのまま | `template_id` | テンプレートごとの構図ルールを適用させる | 書体・配色・座標 |
| （画面で選ぶ）`layoutId` | 既定は `classic` | `layout_id` | 文字が載る帯を平らに保たせる | 文字ブロックの座標 |

送らない項目と、その理由。

| 画面の項目 | 理由 |
| --- | --- |
| `organizerDisplayName` | チラシに主催者名を描かない。公開ページの表示だけに使う |
| `rsvpDeadline` | チラシの描画対象ではない。募集締切は告知ページが持つ |
| `status` | 下書き・公開などの運用状態で、絵柄に影響しない |
| `flyerAssetId` | 既存チラシへの参照。生成の入力ではない |
| `postalCode` / `prefecture` / `town` / `addressLine` / `building` | 画面上の住所は `venueName` と `city` に畳んで `location` へ送る |
| `count`（BFF が足す） | 何枚作るかという操作パラメータ。`_CONTEXT_KEYS` に無いのでプロンプトへは渡らない |

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
- 画面は 50 文字、サービスは 40 文字で、長い入力をすると 400 になっていた
- `model_dump_json()` の素通しで `count` まで LLM へ渡っていた
- 候補を経ない `POST /api/v1/flyers/generate` だけ、余白と切り抜きの指示が無かった
- `IMAGE_SIZE` が原価見積りにしか効いておらず、実際のリクエストとずれていた
