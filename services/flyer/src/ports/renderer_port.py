"""決定論的文字合成のポート。外部 API クライアントを知らない。"""

from __future__ import annotations

from abc import ABC, abstractmethod

from src.domain.models import FlyerGenerationRequest, LLMGenerationContext


class FlyerRendererPort(ABC):
    """背景の上にテキストと遮光マスクを決定論的に合成する。"""

    @abstractmethod
    def render_flyer(
        self,
        background_bytes: bytes,
        request: FlyerGenerationRequest,
        context: LLMGenerationContext,
    ) -> bytes:
        """完成画像のバイト列を返す。ネットワーク I/O を行ってはならない。"""
