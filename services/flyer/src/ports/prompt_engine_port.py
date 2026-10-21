"""プロンプト合成エンジンのポート。"""

from __future__ import annotations

from abc import ABC, abstractmethod

from src.domain.models import FlyerGenerationRequest, LLMGenerationContext


class PromptEnginePort(ABC):
    """入力情報から背景用プロンプトとスタイルパラメータを得る。"""

    @abstractmethod
    async def generate_prompt_context(
        self,
        request: FlyerGenerationRequest,
    ) -> LLMGenerationContext:
        """催し情報を解釈し、文字を描かせない画像プロンプトを構造化して返す。"""
