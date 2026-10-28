実装を読むための基礎知識
========================

読む順の 5 番です。前は :doc:`index`、次は :doc:`run-cycle` です。

このページは、``tests/`` のファイルを開いて中身が読めるようになるための最小限です。Vitest の全機能ではなく、このリポジトリで実際に使っている書き方と、これから使う書き方に絞ります。

テストファイルの形
------------------

``tests/unit/problem.test.ts`` の冒頭です。

.. code-block:: typescript

   import { describe, expect, it } from "vitest";
   import { isRegisterRequired, problemMessage } from "@/lib/problem";
   import { isEventId } from "@/lib/ids";

   describe("isRegisterRequired", () => {
     it("REGISTER_REQUIRED だけを会員登録の要求として扱う", () => {
       expect(isRegisterRequired({ error: "REGISTER_REQUIRED" })).toBe(true);
       expect(isRegisterRequired({ error: "PHONE_REQUIRED" })).toBe(false);
       expect(isRegisterRequired({})).toBe(false);
     });
   });

読む順は次の四つです。

.. list-table::
   :header-rows: 1
   :widths: 20 80

   * - 要素
     - 意味
   * - ``import``
     - 1 行目でテストの道具を取る。``globals`` を有効にしていないので、``describe`` も ``expect`` も毎回 import する
   * - ``describe``
     - まとまりの名前。製品コードの関数名か、確かめる対象を書く
   * - ``it``
     - 1 つの条件。**日本語で条件を書く**。失敗したときに、この文字列がそのまま報告に出る
   * - ``expect``
     - 実際の値と期待値の比較。``expect(実際).toBe(期待)`` の順に書く

``it`` の中は、準備、実行、確認の 3 段にします。空行で区切ると読みやすくなります。

.. code-block:: typescript

   it("筆頭幹事として1件持っていれば2件目を断る", async () => {
     const event = await seedEvent({ guestTokenHash: "hash-owner", role: "OWNER" });

     await expect(assertGuestCanCreate(["hash-owner"])).rejects.toBeInstanceOf(ProblemDetailException);

     expect(event.organizers[0].role).toBe("OWNER");
   });

マッチャの読み方
----------------

``expect(...)`` の後ろに付くメソッドをマッチャと呼びます。このリポジトリで使っているものだけで足ります。

.. list-table::
   :header-rows: 1
   :widths: 30 70

   * - 書き方
     - 意味
   * - ``toBe(値)``
     - ``Object.is`` で同じか。数、文字列、真偽値、同じオブジェクトの参照に使う
   * - ``toBeInstanceOf(クラス)``
     - そのクラスの実体か。例外の種類を見るときに使う（``ProblemDetailException``）
   * - ``not.toThrow()``
     - 例外が出ないこと。関数を ``() => f(...)`` で包んで渡す
   * - ``resolves.toBeUndefined()``
     - ``Promise`` が成功し、結果が ``undefined`` であること
   * - ``rejects.toBeInstanceOf(クラス)``
     - ``Promise`` が失敗し、その例外の種類が一致すること
   * - ``toBeNull()``
     - ``null`` であること。``undefined`` とは区別される

``resolves`` と ``rejects`` は ``await`` を付けます。付け忘れると、失敗を待たずにテストが終わり、**常に成功してしまいます**。

.. code-block:: typescript

   // 正しい
   await expect(assertGuestCanCreate(["hash-owner"])).rejects.toBeInstanceOf(ProblemDetailException);

   // 誤り。await が無いので、例外が起きても検出されない
   expect(assertGuestCanCreate(["hash-owner"])).rejects.toBeInstanceOf(ProblemDetailException);

例外の中身を見るときは、``try`` で受けてからプロパティを確かめます。``tests/unit/guest-edit-window.test.ts`` の形です。

.. code-block:: typescript

   try {
     assertGuestEditWindow(guest, createdAt, createdAt.getTime() + GUEST_EDIT_WINDOW_MS + 1);
     throw new Error("例外が出ませんでした");
   } catch (error) {
     expect(error).toBeInstanceOf(ProblemDetailException);
     const problem = error as ProblemDetailException;
     expect(problem.status).toBe(403);
     expect(problem.type).toBe("probs/register-required");
     expect(problem.extras.error).toBe("REGISTER_REQUIRED");
   }

``assertGuestEditWindow`` が例外を出さなかった場合、``catch`` に入らずテストがそのまま終わって成功してしまいます。だから ``try`` の最後に「例外が出ませんでした」を投げて、**成功しないようにしています**。

フックと後片付け
----------------

``beforeEach`` / ``afterEach`` は、各 ``it`` の前後に走ります。結合テストでは、作った行を消すために使います（``tests/integration/hydrate.test.ts``）。

.. code-block:: typescript

   describeDb("assertGuestCanCreate（結合）", () => {
     const eventIds: string[] = [];

     afterEach(async () => {
       await cleanup({ eventIds });
       eventIds.length = 0;
     });

     it("初回は通す", async () => { /* ... */ });
   });

``eventIds`` を ``describe`` の外ではなく中に置くのが要点です。テストごとに空の配列から始まり、前のテストの ID が混ざりません。消し忘れると、次の実行で件数が合わなくなります。

条件付きの実行
--------------

データベースが無い環境で結合テストを落とさないため、``describe`` 自体を差し替えます。``tests/integration/hydrate.test.ts`` の先頭です。

.. code-block:: typescript

   const describeDb = process.env.TEST_DATABASE_URL ? describe : describe.skip;

   describeDb("ゲスト幹事の付け替え（結合）", () => {
     // TEST_DATABASE_URL が無ければ、この中の it は 1 件も実行されない
   });

``describe.skip`` は、中の ``it`` を、**成功でも失敗でもない「skip」として数えます**。実行結果の件数には出ますが、中身は 1 行も走りません。テスト用 DB を用意し忘れた日に緑になるのは、このためです。

import の読み方
---------------

``@/`` は ``src/`` です。``@/lib/prisma`` は ``src/lib/prisma.ts``、``@/modules/billing/lib/quota`` は ``src/modules/billing/lib/quota.ts`` です。

Route Handler を試験するときは、``src/app/api/`` の下のファイルから ``GET`` や ``POST`` を直接 import します。サーバーは立てません。``NextRequest`` は ``next/server`` から作り、URL とボディを渡します。

.. code-block:: typescript

   import { POST } from "@/app/api/v1/public/events/route";
   import { NextRequest } from "next/server";

   const request = new NextRequest("http://localhost:3012/api/v1/public/events", {
     method: "POST",
     body: JSON.stringify({ title: "テスト" }),
   });

   const response = await POST(request);
   expect(response.status).toBe(403);

モック
------

外部 I/O を偽物にするときに使います。まだこのリポジトリでは使っていませんが、ルート試験を書くときに必要になります。

.. list-table::
   :header-rows: 1
   :widths: 26 74

   * - 道具
     - 用途
   * - ``vi.fn()``
     - 呼ばれた回数と引数を記録する偽の関数。``mockResolvedValue`` で戻り値を決める
   * - ``vi.mock("@/lib/prisma", ...)``
     - モジュールごと差し替える。ファイルの先頭に書き、``import`` より先に評価される
   * - ``vi.spyOn(対象, "名前")``
     - 既存の関数の一部だけを差し替え、元の実装を呼ぶかどうかを選べる
   * - ``vi.useFakeTimers()``
     - ``Date.now()`` や ``setTimeout`` を止めて、時刻を固定する

``vi.mock`` は巻き上げ（hoisting）されるので、``const`` で用意した変数を中で参照すると初期化前に読まれて失敗します。共有したい値は ``vi.hoisted()`` で作ります。

型との関係
----------

``tsconfig.json`` の ``include`` が ``**/*.ts`` を含むため、``tests/`` も ``tsc --noEmit`` の対象です。テストの型が壊れると ``npm run check`` が落ちます。

``vitest`` の型は ``import`` から取るので、``types`` に ``vitest/globals`` を足す必要はありません。``describe`` などを import せずに書くと、型でも実行でも失敗します。

テストの地図
------------

.. list-table::
   :header-rows: 1
   :widths: 30 14 56

   * - 場所
     - 件数
     - 何を置くか
   * - ``tests/unit/``
     - 36
     - 純粋関数。データベースも通信も要らない。``describe.skip`` を使わない
   * - ``tests/integration/``
     - 7
     - テスト用 PostgreSQL が要るもの。``describeDb`` で条件付き実行
   * - ``tests/integration/helpers.ts``
     - —
     - 行の作成（``seedEvent``）と削除（``cleanup``）。テストではないので集められない
   * - ``tests/setup/db.ts``
     - —
     - 全テストの前に 1 回走る。``DATABASE_URL`` の差し替え
   * - ``tests/routes/`` ``tests/components/``
     - 0
     - これから作る。ルートは ``tests/routes/``、画面は ``tests/components/`` です（:doc:`../scope`）

現在のファイル数と件数は :doc:`../scope` の「現在のテスト」にあります。``TEST_DATABASE_URL`` の無い環境では、``tests/unit/`` だけが実行され、``tests/integration/`` は skip されます。内訳と、それぞれが何を見ているかも同じページにあります。

つまずきやすい点
----------------

1. ``.test.tsx`` は集められません。``include`` が ``tests/**/*.test.ts`` なので、拡張子が違うファイルは黙って無視されます。件数が増えないときはまずここを疑います。
2. ``document`` がありません。``environment: "node"`` なので、画面のコードを import した時点で ``ReferenceError`` になります。
3. skip は成功です。``TEST_DATABASE_URL`` が無いと結合テストは skip され、終了コードは 0 になります。``npm run test:db`` が「成功」しても、DB を見たことになっていない場合があります。
4. ``TEST_DATABASE_URL`` に開発用 DB を書くと壊れます。``tests/setup/db.ts`` は ``DATABASE_URL`` をそのまま上書きします。``event_platform_billing_test`` だけを指します。
5. Prisma の接続先は import 時に決まります。テストの中で ``process.env.DATABASE_URL`` を書き換えても間に合いません。``setupFiles`` が先に走る前提を崩さないでください。
6. ``describe`` などを import し忘れると落ちます。型検査と実行の両方で失敗します。``globals`` は有効にしていません。
7. 後片付けを忘れると次の実行が汚れます。結合テストは ``afterEach`` で消しています。テストを足すときも同じ形にします。

次に読む
--------

:doc:`run-cycle`
