イベント作成の音声入力
============================

イベント作成画面（ ``/organizer/events/new`` ）の右下にマイクボタンを固定し、押すと音声モードに入ります。
音声モードでは、上から順に空欄へ「見た目だけのフォーカス」を当て、1 欄ずつ話して埋めていきます。

このページは、音声入力の使い方と、OpenAI の音声認識 API の導入手順をまとめます。
実装の正はコードです。差分を見つけたら、コードとこのページを同じ PR で直します。

仕組み
------

音声はブラウザで録音し、アプリの API を通して OpenAI の音声認識へ中継します。
返ってきた文字を、欄ごとの決まった規則でフォームの値に変換します。

.. code-block:: text

   マイク
     → MediaRecorder（webm/opus。Safari は mp4）
     → POST /api/v1/voice/transcriptions（アプリのサーバー）
     → POST https://api.openai.com/v1/audio/transcriptions（OpenAI）
     → 文字
     → src/modules/events/lib/voice/parse.ts（欄ごとの抽出）
     → EventFormValues の部分更新

文字を値に変える部分は LLM を使いません。欄が決まっていれば、日付・時刻・金額・人数は
正規表現と辞書で決定的に読めます。同じ発話が常に同じ値になるため、テストで仕様を固定できます。

画面の操作
----------

.. list-table::
   :header-rows: 1
   :widths: 26 74

   * - 操作
     - 動き
   * - 右下のマイクボタン
     - 音声モードに入る／終了する。 ``Esc`` でも終了する
   * - 「話す」
     - 録音を始める。もう一度押す（「停止して入力」）まで録音する
   * - 「言い直す」
     - すでに値が入っている欄をもう一度録音して上書きする
   * - 「戻る」
     - ひとつ前の欄に戻る。値は消さない
   * - 「スキップ」
     - その欄を飛ばして次へ進む
   * - 「任意の項目も聞く」
     - 雨天時の方針・定員・申し込み期限も巡回に加える。既定は空欄だけを聞く
   * - 画面の暗い部分
     - 操作できない。押すと抜け方をパネルに出す
   * - いま聞いている欄
     - その欄だけは触れる。音声で入れた値を手で直すときは、そのまま編集する

フォーカスは見た目だけ
^^^^^^^^^^^^^^^^^^^^^^

音声モードは入力欄の DOM フォーカスを動かしません。枠を強調して、画面内へスクロールするだけです。

``type="date"`` と ``type="time"`` に実フォーカスを当てると、スマートフォンでは OS の日付・時刻ピッカーが開き、
画面を覆ってマイクの操作を妨げます。そのため、強調は ``data-voice-target`` 属性と CSS で行います。
読み上げには ``aria-live`` で欄の名前と誘導文を流します。

覆いと操作の制限
^^^^^^^^^^^^^^^^

音声モードの間は、画面全体を半透明の黒（ ``.voice-scrim`` ）で覆います。いま聞いている欄のまわりだけを
``clip-path`` でくり抜き、その内側だけ触れるようにします。くり抜きは当たり判定にも効くため、
他の欄・ステップの見出し・フッターは押せません。右下のパネルとマイクボタンは覆いより手前に出ます。

欄の矩形はスクロールやスマートフォンのキーボードで動くため、穴を測り直して追いかけます。
測るのは位置が動く合図（ ``scroll`` ・ ``resize`` ・ ``ResizeObserver`` ・ ``data-voice-target`` の付け替え）があったときだけで、
毎フレームは回しません。対象の欄が見つからないとき（入力できる欄がすべて埋まったとき）は覆いを出しません。

手で直すときは、いま聞いている欄をそのまま編集するか、``Esc`` かパネルの「終了」で音声モードを抜けます。

録音の制限
^^^^^^^^^^

* 1 回の録音は最大 60 秒。超えると自動で止まる
* 送る音声は 5MB まで
* 録音を始めるまでマイクの許可は求めない。許可を拒否されたら手入力に戻る
* 録音は保存しない。文字にして返したら捨てる

API
---

``POST /api/v1/voice/transcriptions``

.. list-table::
   :header-rows: 1
   :widths: 24 76

   * - 項目
     - 内容
   * - 方式
     - ``multipart/form-data``
   * - ``audio``
     - 必須。音声ファイル。``audio/webm``、``audio/mp4``、``audio/ogg``、``audio/wav``、``audio/mpeg`` のいずれか。5MB まで
   * - ``field``
     - 任意。欄の名前（ ``title`` 、 ``scheduleDate`` など）。認識モデルに渡す語彙のヒントにだけ使う
   * - 成功
     - ``200`` と ``{"text": "12月5日", "model": "gpt-4o-mini-transcribe"}``
   * - 失敗
     - RFC 7807 の ``application/problem+json``

.. list-table::
   :header-rows: 1
   :widths: 14 20 66

   * - 状態
     - ``error``
     - 意味と画面の動き
   * - ``400``
     - ``-``
     - 音声が空、または本文を読めない。もう一度録音する
   * - ``413``
     - ``-``
     - 5MB を超えた。短く話す
   * - ``415``
     - ``-``
     - 音声以外の形式。ブラウザの録音形式を確認する
   * - ``422``
     - ``TRANSCRIBE_EMPTY``
     - 聞き取れなかった。もう一度話すか手で入力する
   * - ``429``
     - ``RATE_LIMITED`` / ``TRANSCRIBE_BUSY``
     - 回数の上限、または上流が混雑。 ``Retry-After`` に従う
   * - ``502``
     - ``TRANSCRIBE_MISCONFIGURED`` / ``TRANSCRIBE_FAILED``
     - 鍵の設定不備、または上流に繋がらない。手で入力する
   * - ``503``
     - ``TRANSCRIBE_DISABLED``
     - ``OPENAI_API_KEY`` が未設定。手で入力する

上限に当たると ``429`` に ``Retry-After`` と ``X-RateLimit-Limit`` 、 ``X-RateLimit-Remaining`` が付きます。
本文には ``limitLabel`` 、 ``attemptLimit`` 、 ``windowSeconds`` 、 ``retryAfterSeconds`` 、 ``retryAt`` が入ります。

導入手順
--------

1. OpenAI の API キーを用意する
^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^

`OpenAI Platform <https://platform.openai.com/api-keys>`_ で API キーを作ります。
音声認識は ``gpt-4o-mini-transcribe`` を使います。モデル名は環境変数で差し替えられます。

2. 環境変数を置く
^^^^^^^^^^^^^^^^^

``.env`` （ローカル）または配信先のシークレットに、次を設定します。

.. code-block:: ini

   OPENAI_API_KEY="sk-..."
   VOICE_TRANSCRIBE_MODEL=""

``VOICE_TRANSCRIBE_MODEL`` が空なら ``gpt-4o-mini-transcribe`` を使います。
``OPENAI_API_KEY`` が空のとき、画面のマイクボタンは押せますが、録音を送った時点で
「音声入力は現在利用できません」と出て、手入力に戻ります。アプリは起動したままです。

.. list-table::
   :header-rows: 1
   :widths: 40 20 40

   * - 名前
     - 既定
     - 役割
   * - ``OPENAI_API_KEY``
     - なし
     - 音声認識の鍵。未設定なら音声入力は無効
   * - ``VOICE_TRANSCRIBE_MODEL``
     - ``gpt-4o-mini-transcribe``
     - 認識モデル
   * - ``VOICE_TRANSCRIBE_LIMIT``
     - ``40``
     - 接続元（IP）ごとの回数。窓の中で数える
   * - ``VOICE_TRANSCRIBE_WINDOW_MINUTES``
     - ``60``
     - 回数を数える窓（分）
   * - ``VOICE_TRANSCRIBE_MOCK``
     - ``0``
     - ``1`` なら OpenAI を呼ばず、欄の入力例を認識結果にする（開発用）

3. 課金と上限を決める
^^^^^^^^^^^^^^^^^^^^^

音声認識は従量課金です。執筆時点の公開価格は 1 分あたり約 0.003 ドルですが、**必ず公式の料金ページで確認してください**。
1 欄あたり 3〜8 秒とすると、1 件（15 欄前後）でおよそ 1〜2 分です。

既定の上限 ``40 回 / 1 時間 / IP`` は、1 人が 2 件ぶん作れる程度です。
大人数が同時に使う環境では ``VOICE_TRANSCRIBE_LIMIT`` を上げてください。

数えるのはプロセスのメモリ上です。インスタンスを増やすと合計の上限も増えるため、
厳密に止めたい場合は DB か共有ストアへ移す必要があります（未実装）。

4. 動作を確かめる
^^^^^^^^^^^^^^^^^

.. code-block:: powershell

   npm run dev

``/organizer/events/new`` を開き、右下のマイクボタンを押します。
「催しの名前」から順に強調されるので、「忘年会」と話して「停止して入力」を押します。
値が入って次の欄へ進めば成功です。

開発ツールの Network で ``/api/v1/voice/transcriptions`` が ``200`` を返すことも確認できます。

.. list-table::
   :header-rows: 1
   :widths: 30 70

   * - 症状
     - 見るところ
   * - マイクボタンを押しても録音が始まらない
     - ブラウザのマイク許可。``https`` または ``localhost`` で開いているか
   * - 「音声入力は現在利用できません」
     - ``OPENAI_API_KEY`` が空。サーバーを再起動したか
   * - 「音声認識の設定が正しくありません」
     - 鍵が無効、または音声認識の権限が無い
   * - 値が入らない
     - 画面に出た「読めませんでした」の文言。欄に対して言い方が合っているか
   * - すぐ上限になる
     - ``VOICE_TRANSCRIBE_LIMIT`` 。開発中は大きめにする

5. 課金せずに試す（モック）
^^^^^^^^^^^^^^^^^^^^^^^^^^

鍵を用意せず、課金もせずに画面の流れを確かめたいときは ``VOICE_TRANSCRIBE_MOCK=1`` を使います。

.. code-block:: ini

   VOICE_TRANSCRIBE_MOCK=1

有効にすると、認識の問い合わせだけを差し替えます。OpenAI へは送らず、
いま聞いている欄の入力例（ ``fields.ts`` の ``example`` 。「12月5日」「3000円」など）を
認識結果として返します。入力例は ``parse.ts`` が読める形で書いてあるため、
聞き直しにならず次の欄へ進みます。

* 差し替えるのは認識だけです。録音とマイクの許可はそのまま要ります。無言で「停止して入力」でも構いません
* ``OPENAI_API_KEY`` は空のままで動きます。503 の ``TRANSCRIBE_DISABLED`` は出ません
* 回数の上限を数えません。開発中に ``429`` で止まらないようにするためです
* 応答の ``model`` は ``mock`` になります。実モデル名と取り違えないようにしています
* ``NODE_ENV=production`` では常に無効です。``next build`` と ``next start`` が該当します
* 設定が効いているか分からないときは、サーバーのログを見てください。``/api/v1/voice/transcriptions`` を初めて読み込んだ時点で、次のどちらかが 1 度だけ出ます

.. code-block:: text

   [voice] モックが有効です（VOICE_TRANSCRIBE_MOCK=1）。OpenAI へは送らず、欄の入力例を返します。
   [voice] OPENAI_API_KEY が未設定です。音声入力を送ると 503（TRANSCRIBE_DISABLED）になります。

モックの付け忘れと切り忘れの両方に気づけるようにするためです。本番では出ません。

確かめられるのは、録音から送信、``parse.ts`` による値の決定、フォームへの反映、
ステップの自動展開、次の欄への巡回までです。認識の精度だけは対象外です。

モデルや提供元を変える
----------------------

差し替える場所は 1 ファイルです。

.. list-table::
   :header-rows: 1
   :widths: 40 60

   * - ファイル
     - 役割
   * - ``src/modules/events/lib/voice/openai.ts``
     - OpenAI への送信、エラーの対応付け、``prompt`` の組み立て
   * - ``src/modules/events/lib/voice/parse.ts``
     - 認識結果をフォームの値へ変える規則。ここは提供元に依存しない
   * - ``src/modules/events/lib/voice/fields.ts``
     - 欄の並び、空欄の判定、次に聞く欄、語彙のヒント

``parse.ts`` と ``fields.ts`` は文字だけを受け取るので、提供元を変えても触りません。
``openai.ts`` の ``transcribeWithOpenAi`` を同じ形（文字を返す）で置き換えれば、
API ルートと画面はそのまま動きます。

.. list-table::
   :header-rows: 1
   :widths: 26 74

   * - 提供元
     - 変えるところ
   * - OpenAI の別モデル
     - ``VOICE_TRANSCRIBE_MODEL`` を変える。``whisper-1`` は ``response_format`` に ``verbose_json`` も使える
   * - 何も呼ばない（モック）
     - ``VOICE_TRANSCRIBE_MOCK=1`` 。``openai.ts`` は鍵より先に ``mockTranscript`` を返す
   * - 自前のサーバー（Whisper など）
     - ``transcribeWithOpenAi`` の ``fetch`` 先を自前の URL にし、``OPENAI_API_KEY`` の代わりの鍵を読む。``.env.example`` とこのページを更新する
   * - 端末内の認識（WASM）
     - ``src/modules/events/lib/voice/transcribe.ts`` を、録音を送らずに端末で文字へする実装に差し替える。API ルートは不要になる

音声入力を作っているファイル
----------------------------

.. list-table::
   :header-rows: 1
   :widths: 44 56

   * - ファイル
     - 役割
   * - ``src/modules/events/lib/voice/types.ts``
     - 欄の型、パッチ、抽出の文脈
   * - ``src/modules/events/lib/voice/normalize.ts``
     - 全角の正規化、漢数字、時刻の言い方、日付の解決
   * - ``src/modules/events/lib/voice/parse.ts``
     - 欄ごとの抽出。読めなければ ``null`` を返す
   * - ``src/modules/events/lib/voice/fields.ts``
     - 欄の定義と巡回。空欄の判定、次・前の欄、id からの逆引き
   * - ``src/modules/events/lib/voice/audio.ts``
     - 録音形式の選択、上限
   * - ``src/modules/events/lib/voice/transcribe.ts``
     - 画面から API を呼ぶ
   * - ``src/modules/events/lib/voice/openai.ts``
     - サーバー側の OpenAI 呼び出し
   * - ``src/modules/events/lib/voice/mock.ts``
     - 課金せずに試すための差し替え。欄の入力例を認識結果にし、起動時に設定を 1 度ログへ出す
   * - ``src/modules/events/lib/voice/rate-limit.ts``
     - 接続元ごとの回数制限
   * - ``src/app/api/v1/voice/transcriptions/route.ts``
     - API ルート。保存しない
   * - ``src/modules/events/components/VoiceInputDock.tsx``
     - 右下のボタンとパネル。状態機械と録音
   * - ``src/modules/events/components/EventStepForm.tsx``
     - ``voiceSlot`` でパネルを受け取り、ステップを開く入口を渡す

プライバシー
------------

* 録音はアプリのサーバーを経由して OpenAI へ送ります。端末内で完結しません
* 音声も認識結果も保存しません。DB に列はありません
* 音声は認識のためだけに使い、学習には使いません（OpenAI の API 利用規約に従う）
* 録音を始めるまでマイクを開きません。押したときだけ許可を求めます

テスト
------

欄の抽出と巡回は純ロジックなので、Vitest で仕様を固定しています。

.. list-table::
   :header-rows: 1
   :widths: 46 54

   * - ファイル
     - 確かめていること
   * - ``tests/unit/voice-parse.test.ts``
     - 全角の正規化、漢数字、日付の年解決、時刻の範囲、金額、定員、住所、雨天、期限
   * - ``tests/unit/voice-fields.test.ts``
     - 欄の並び、空欄の飛ばし方、任意の欄、戻る、id からの逆引き、パッチの適用
   * - ``tests/unit/voice-mock.test.ts``
     - モックの有効判定（本番では無効）、全欄の入力例が読めること、鍵なしで外部を呼ばないこと、API の応答と回数制限の扱い、起動ログの出し分けと 1 度だけ出すこと

音声そのもの（マイク・通信・モデルの精度）は自動テストの対象外です。手で確かめます。
モックは録音を差し替えないため、マイクと許可は手で確かめる範囲に残ります。

制約
----

* 先頭の行だけを音声で埋める。2 件目以降の開催日時・費用プランは「日時を追加」「プランを追加」で手入力する
* 男女別の費用は音声の対象外。切り替えると参加者の選択が外れるため、手で操作する
* 音声認識の文字が欄の意味に合わないときは「読めませんでした」と出して値を変えない。勝手に埋めない
* 回数の上限はプロセスのメモリ上。インスタンスごとに数える
* 編集画面（ ``/organizer/events/[id]/edit`` ）は対象外
