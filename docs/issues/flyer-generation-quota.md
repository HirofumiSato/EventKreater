# チラシ生成の回数を生成時に消費し、途中離脱で戻らないようにする

> チラシの回数を保存時ではなく AI 背景の生成時に消費し、数える単位をクライアントの下書き ID から会員・端末へ移す issue。途中で閉じても、下書き ID を作り直しても回数が戻らないようにする。

## 背景

チラシの回数は `flyer_generation_logs` で数えていたが、数えるのは保存（`POST /api/v1/flyers/generate`）のときだけで、単位はクライアントが送る `draftKey` だった。そのため、次の 2 つの穴が残っていた。

- **途中で閉じると回数が戻る。** AI の背景を作った時点で画像生成 API の課金は起きているのに、保存しなければ回数は減らない。「別の背景を作る」を繰り返しても同じである。
- **下書き ID を作り直すと回数が戻る。** `draftKey` はブラウザの `localStorage` に置いた値で、消して作り直せば新しい枠になる。クライアントが指定するキーで回数を数える限り、この穴は塞げない。

## 決定

| 論点 | 決定 |
| :---- | :---- |
| 1 回の単位 | AI の背景 1 枚。`POST /api/v1/flyers/candidates` が AI の候補を返した時点で消費する。「別の背景を作る」も 1 回 |
| 消費しない操作 | 保存（`/generate`）、紙面の性格の選び直し（`/types`）、背景のアップロード、完成画像のアップロード |
| 数える行 | `flyer_generation_logs` のうち `source = 'ai'` の行だけ。`placeholder`（代替背景）と `upload` は記録のみ |
| 数える単位 | 保存済みイベントは `event_id`。公開前はログイン済みが `user_id`、未ログインが `owner_token_hash`（どちらも `event_id` は NULL） |
| `draftKey` | 廃止する。回数の単位はサーバーが所有者から決め、クライアントの値では増やせない |
| 未確定分の付け替え | イベントを新規に作った時点（`POST /api/v1/public/events`）で、ログイン中の会員の `event_id` が NULL の行をそのイベントへ付ける。下書き保存では付け替えない。未ログインの端末の行は付け替えない |
| 候補と保存の紐付け | `flyer_generation_logs.candidate_id` に候補 ID を残し、保存時に `backgroundCandidateId` で 1 行を `flyer_asset_id` へ結ぶ。二重保存は 409 |
| 同時生成 | 候補の記録と上限の数え直しは直列化可能トランザクションで行う（P2034 は 2 回まで再試行） |
| 画面の文言 | 「作成を始めると 1 回消費します。」「保存と紙面の選び直しは消費しません」に揃える |

## フロー

```text
[背景を作る]
POST /flyers/candidates（draftKey なし）
  → 残り 0 : 403 FLYER_QUOTA_EXCEEDED / REGISTER_REQUIRED（AI を呼ばない）
  → 残りあり: サービスへ count を残りまでで渡す
              → source 付きで 1 枚ずつ記録（ai だけ消費）

[保存する]
POST /flyers/generate（candidateId, backgroundCandidateId）
  → 候補の完成画像を保存（消費しない）
  → 生成ログの candidate_id に flyer_asset_id を結ぶ

[イベントを作る]
POST /public/events
  → ログイン中の会員の event_id が NULL の行を、このイベントへ付け替える
```

## 実装方針

| ファイル | 役割 |
| :---- | :---- |
| `prisma/schema.prisma` / `prisma/migrations/` | `candidate_id` / `source` を足し、`draft_key` を NULL 可にする |
| `src/modules/flyers/lib/quota.ts` | `scopeWhere` から `draftKey` を外し、`source: "ai"` で数える。`recordFlyerCandidates` / `attachFlyerAssetToLog` / `attributePendingFlyerLogs` |
| `src/modules/flyers/lib/scope.ts` | `resolveFlyerQuotaScope` から `draftKey` を外す |
| `src/modules/flyers/lib/quota-label.ts` | 文言を「背景を作れるのは、残り N 枚」へ |
| `src/lib/schemas.ts` | `draftKey` / `flyerDraftKey` を削除し、`backgroundCandidateId` を足す |
| `src/app/api/v1/flyers/candidates/route.ts` | 先に残りを確かめ、候補を記録してから返す |
| `src/app/api/v1/flyers/uploads/route.ts` | `source: "upload"` で記録（消費しない） |
| `src/app/api/v1/flyers/generate/route.ts` | 回数の判定を外し、候補の生成履歴に `flyer_asset_id` を結ぶ |
| `src/modules/events/lib/events.ts` | イベント新規作成で未確定分を付け替える |
| `src/modules/flyers/components/FlyerGeneratePanel.tsx` / `FlyerCandidateModal.tsx` | `draftKey` を外し、消費のタイミングを案内する |

## 受け入れ条件

- [ ] 背景を 3 枚作って保存せずに閉じ、開き直すと 4 枚目が 403 `FLYER_QUOTA_EXCEEDED` になる
- [ ] 保存だけでは回数が減らず、紙面の性格の選び直しでも減らない
- [ ] 背景のアップロードと完成画像のアップロードでは回数が減らない
- [ ] 下書きを保存して新しいイベントを作ると、また 3 枚作れる
- [ ] 未ログインの 2 枚目は 403 `REGISTER_REQUIRED` になる
- [ ] 他人のイベント ID や適当な `draftKey` を送っても枠が増えない
- [ ] 同じイベントで同時に作っても 4 枚目が通らない
- [ ] 二重保存は 409 `CANDIDATE_ALREADY_SAVED` になる
- [ ] `npm run check` が通る

## スコープ外

- Python サービスの 1 時間 3 枚の AI 上限（従来のまま）
- 完成画像のアップロードの回数（従来どおり消費しない）
- 会員ごとのローリング上限（下書きを削除して作り直すと再び 3 枚になるため、より強く止めるなら別 PR）
- 未ログインの Cookie を消したときの 1 枚（画面は新規作成に会員登録を要求する。IP 制限はプロキシ前提のため入れない）
- `npm run mock:sync`（実装 PR では回さず、追いつきは別のタイミング）

## 参考

- `src/modules/flyers/lib/quota.ts` — 回数の数え方
- `src/app/api/v1/flyers/candidates/route.ts` — 背景候補の生成
- `src/app/api/v1/flyers/generate/route.ts` — 保存と候補の紐付け
- `src/modules/events/lib/events.ts` — イベント作成時の付け替え
- `docs/backend_api_implementation_spec.md` — §9 チラシ生成 API
- `docs/DBschema.md` — `flyer_generation_logs`
- `docs/front_implementation_spec.md` — SCR-ORG-08 / FE-ORG-19
- `docs/flyer/http_api.rst` — flyer サービスの契約
- `docs/billing_and_quota_system_requirements.md` — 下書きの件数上限
