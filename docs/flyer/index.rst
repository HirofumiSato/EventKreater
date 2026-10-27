AIチラシ自動生成
================

小規模店舗やイベント主催者が、催しの事実情報とデザインの型を渡すだけで、A4 縦（1080×1528）の告知画像を受け取れる Web API です。

背景の雰囲気は言語モデルと画像生成 API が作ります。日付、料金、場所、タイトルといった文字はサーバーの Pillow が座標を決めて描きます。画像モデルに日本語や数字を書かせないことで、誤字と桁の改変を避けます。

.. toctree::
   :maxdepth: 2
   :caption: ガイドの前に

   catchup/index

.. toctree::
   :maxdepth: 2
   :caption: ガイド

   sphinx_structure
   overview
   architecture
   pipeline
   http_api
   rendering
   configuration
   local_run
   swagger
   testing/index
   development

.. toctree::
   :maxdepth: 2
   :caption: 導入ライブラリ

   libraries/index

.. toctree::
   :maxdepth: 2
   :caption: 仕様書

   specs/index

.. toctree::
   :maxdepth: 2
   :caption: API リファレンス

   reference/index
