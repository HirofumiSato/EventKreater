# SCR-PUB-03（主催者マイページ）を主催者エリアに戻し、画面遷移の定義を1本化する

> 画面遷移の総点検で見つかった、文書どうしの食い違いを直す issue。課金まわりの実装変更は [draft-checkout-and-publish.md](draft-checkout-and-publish.md) に分けた。

## 背景

`docs/front_implementation_spec.md` の画面遷移図（2.3）では、SCR-PUB-03 `/mypage`（主催者マイページ）が「参加者」のサブグラフに入っていた。2.2 の画面一覧でも区分が「会員」となっており、主催者の画面であることが読み取れない。

`docs/overall_system_requirements_common.md` 側にも同じ食い違いがあり、`/mypage` を「参加者の申込一覧」と説明する箇所が残っている。実際の `/mypage` は主催イベントの要約・クォータ残数・契約管理・公開プロフィールを並べる**主催者のホーム**であり、参加者の申込一覧は SCR-PUB-08 `/participant`、参加履歴は SCR-PUB-09 `/participant/history` が担う。

また、次の遷移が文書と実装で揃っていなかった。

| 箇所 | 文書 | 実装 |
| :---- | :---- | :---- |
| SCR-ORG-10 `/organizer/register-required` の登録後 | `/organizer/events/[id]/edit` | `/organizer/events` |
| SCR-ORG-11 / SCR-ORG-14 のゲスト 403 | `/auth/register`（`next` 無し） | `next` 付き |
| SCR-ADM-02 → SCR-PUB-01 | 記載無し（共通編 6.3 が禁止） | リンクあり |
| 主催者サブタブ | 3タブ（プロフィール節と不一致） | 4タブ |
| 下書きイベントの「公開ページ」 | 記載無し | リンクが出て 404 |

## 決定

| 論点 | 決定 |
| :---- | :---- |
| SCR-PUB-03 の位置 | 主催者エリア（`/mypage` は Navbar の `ORGANIZER_AREA_PREFIXES` に含まれる）。参加者サブグラフから外す |
| SCR-PUB-03 の役割 | ダッシュボード。主催イベントの要約（直近N件）＋「すべて見る」→ SCR-ORG-01。全件は SCR-ORG-01 が持つ |
| SCR-PUB-03 に置くもの | クォータ残数、契約管理（Stripe Portal）、公開プロフィールの状態と編集導線、主催イベントの要約 |
| SCR-PUB-03 に置かないもの | 他の主催者の催しへの参加履歴（SCR-PUB-09 へ） |
| SCR-ORG-10 の登録後 | `/organizer/events?registered=1` へ遷移し、完了トーストを出す。編集画面へは直接送らない |
| SCR-ORG-10 の副リンク | 「主催一覧へ」だけ。編集画面への副リンクは置かない（カードから入る） |
| SCR-ORG-11 / SCR-ORG-14 のゲスト 403 | `/auth/register?mode=register&next=<元画面>` |
| SCR-ADM-02 → SCR-PUB-01 | 許可する。行の催し名から公開ページを新しいタブで開く（`target="_blank" rel="noopener noreferrer"`） |
| Navbar の遷移図 | 幹線のみを描き、詳細は 3.1 を正とする旨を凡例に書く |
| 主催者サブタブ | 4タブ（主催一覧・カレンダー・売上・プロフィール）で統一 |
| 下書きイベントの公開ページ | リンクを出さない（`status === "DRAFT"` のとき非表示） |

## 実装方針

### 1. ドキュメント（共通編 → フロントの順）

- `docs/overall_system_requirements_common.md`
  - 3.2 / 3.5 / 4.3 / 5 節の「SCR-PUB-03 = 参加者の申込一覧」を SCR-PUB-08 / 09 に置き換える。
  - 6.2 のサブグラフで SCR-PUB-03 を主催者側へ移す。
  - 6.3 の「管理画面から公開ページへ遷移しない」制約を、新しいタブでの閲覧に限り許可する記述へ改める。
- `docs/front_implementation_spec.md`
  - 2.2 の区分列と説明、2.3 の Mermaid を修正する。
  - サブタブの記述を4タブに揃える。
  - 12.4 / 12.6 の ORG-10・課金復帰の記述を実装に合わせる。
- `docs/backend_api_implementation_spec.md`
  - 下書き作成・公開 API・Checkout の `draftId` / `returnTo` を追記する（詳細は draft-checkout-and-publish.md）。

### 2. 画面

| 画面 | 変更 |
| :---- | :---- |
| `src/app/mypage/page.tsx` | 主催イベントを先頭N件に切り、「すべて見る」で `/organizer/events` へ。カードの公開ページ導線は下書きで出さない |
| `src/app/organizer/events/page.tsx` | `?registered=1` で完了トースト。`useSearchParams` のため `Suspense` で包む |
| `src/app/organizer/register-required/page.tsx` | `nextPath` と遷移先を `/organizer/events` に統一 |
| `src/app/organizer/revenue/page.tsx` | 403 `REGISTER_REQUIRED` の登録導線に `&mode=register` |
| `src/modules/organizers/components/OrganizerProfileForm.tsx` | 同上 |
| `src/modules/events/components/EventCard.tsx` | `status !== "DRAFT"` のときだけ「公開ページ」を出す |
| `src/app/console/events/page.tsx` | 公開ページへのリンクを新しいタブで開く |

### 3. 共通化

- `src/lib/auth-links.ts` を新設し、`registerUrl(next)` / `loginUrl(next)` に寄せる。画面ごとの直書きをやめる。

### 4. テスト

- `tests/unit/auth-links.test.ts`: `next` のエンコードと `mode=register` の付与。
- `tests/unit/guest-draft.test.ts`: 下書きの応答が `publicUrl: null` になり、`guestOrganizerToken` を返さないこと。
- `tests/unit/pending-form.test.ts`: ログイン前の入力の退避と復元、取り出すと 1 回で消えること。
- 既存の画面テストがあれば文言追従。

## 受け入れ条件

- [x] 共通編・フロント仕様書のどちらにも、SCR-PUB-03 が主催者として書かれている
- [x] 画面遷移図で SCR-PUB-03 が主催者サブグラフにあり、ORG-01 / PUB-11 / PUB-08 / PUB-01 / MOD-01 への辺がある
- [x] `/mypage` が主催イベントの要約と「すべて見る」を出し、全件は `/organizer/events` で見られる
- [x] `/mypage` に他の主催者の参加履歴が出ない
- [x] ORG-10 から登録すると `/organizer/events?registered=1` に着地し、トーストが出る
- [x] ORG-11 / ORG-14 のゲスト 403 が `mode=register` と `next` 付きの登録画面へ送る
- [x] 管理画面の催し名から公開ページが新しいタブで開く
- [x] 下書きイベントのカードに公開ページのリンクが出ない
- [x] 主催者サブタブが4タブで、文書と一致している
- [x] `npm run check` が通る

## スコープ外

- 参加者ホーム（`/participant`）の構成変更
- 主催者ホームの通知・未読・タスク一覧
- 管理画面の検索条件や一覧項目の変更
- `/mypage` の URL 変更
