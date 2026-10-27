"""アップロード画像の正規化。

利用者が持ち込んだ写真は、形式・寸法・向きがばらばらで、EXIF に撮影場所
などの個人情報を含む。レンダラーへ渡す前に、許可形式だけを受け入れ、
向きを反映し、メタデータを落として 1080×1528（A4 縦）の PNG に揃える。
"""

from __future__ import annotations

from abc import ABC, abstractmethod


class ImageUploadPort(ABC):
    """アップロード画像を検証し、背景として使える形に揃える。"""

    @abstractmethod
    def normalize(self, payload: bytes) -> bytes:
        """画像を検証し、1080×1528 の PNG（EXIF なし）を返す。"""
