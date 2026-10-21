ガイドを読む前に
================

ここは、Web も Python も画像生成も初めての人が、ガイド（概要から開発まで）を読むための前提です。システムの仕様そのものは書きません。ガイドに出てくる言葉の意味だけを先に置きます。

おすすめの順は次のとおりです。左を読んでから、右のガイドへ進んでください。

.. list-table::
   :header-rows: 1
   :widths: 34 66

   * - 先に読む
     - その後に読むガイド
   * - :doc:`web`
     - :doc:`/flyer/http_api`
   * - :doc:`images`
     - :doc:`/flyer/overview` の「二つの層」、:doc:`/flyer/rendering`
   * - :doc:`ai`
     - :doc:`/flyer/overview`、:doc:`/flyer/pipeline`
   * - :doc:`python_project`
     - :doc:`/flyer/architecture` のディレクトリ、:doc:`/flyer/configuration`、:doc:`/flyer/development`
   * - :doc:`architecture_words`
     - :doc:`before_architecture` と合わせて :doc:`/flyer/architecture`
   * - :doc:`before_architecture`
     - :doc:`/flyer/architecture`
   * - :doc:`before_pipeline`
     - :doc:`/flyer/pipeline`
   * - :doc:`before_rendering`
     - :doc:`/flyer/rendering`

全部を暗記する必要はありません。ガイドで見慣れない語が出たら、ここへ戻ってください。

.. toctree::
   :maxdepth: 1

   web
   images
   ai
   python_project
   architecture_words
   before_architecture
   before_pipeline
   before_rendering
