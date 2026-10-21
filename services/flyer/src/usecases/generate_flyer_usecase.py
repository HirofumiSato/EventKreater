"""入力解釈、背景取得、文字合成、一時保存を直列に実行する。"""

from __future__ import annotations

import logging
from uuid import uuid4

from src.domain.exceptions import (
    FlyerAppException,
    FontRenderError,
    ImageGenerationTimeoutError,
)
from src.domain.models import (
    FlyerGenerationRequest,
    FlyerGenerationResponse,
    FlyerStatus,
    TemplateId,
)
from src.ports.image_generator_port import ImageGeneratorPort
from src.ports.prompt_engine_port import PromptEnginePort
from src.ports.renderer_port import FlyerRendererPort
from src.ports.storage_port import StoragePort

logger = logging.getLogger(__name__)


def _select_template(fallback: ImageGeneratorPort, template_id: TemplateId) -> None:
    selector = getattr(fallback, "set_template", None)
    if callable(selector):
        selector(template_id)


def _generator_used_fallback(generator: ImageGeneratorPort) -> bool:
    return getattr(generator, "used_fallback", False) is True


class GenerateFlyerUseCase:
    """ポートを注入してチラシ生成パイプラインを進める。"""

    def __init__(
        self,
        prompt_engine: PromptEnginePort,
        image_generator: ImageGeneratorPort,
        renderer: FlyerRendererPort,
        storage: StoragePort,
        fallback_images: ImageGeneratorPort,
    ) -> None:
        self._prompt_engine = prompt_engine
        self._image_generator = image_generator
        self._renderer = renderer
        self._storage = storage
        self._fallback_images = fallback_images

    async def execute(self, request: FlyerGenerationRequest) -> FlyerGenerationResponse:
        """入力を解釈し、背景と文字を合成して一時 URL を返す。"""
        context = await self._prompt_engine.generate_prompt_context(request)
        _select_template(self._fallback_images, request.template_id)
        status = FlyerStatus.SUCCESS
        try:
            background = await self._image_generator.generate_background(
                prompt=context.image_prompt_en,
                negative_prompt=context.negative_prompt_en,
                aspect_ratio="9:16",
            )
            if _generator_used_fallback(self._image_generator):
                status = FlyerStatus.FALLBACK_USED
        except ImageGenerationTimeoutError as exc:
            logger.warning("Image generation timed out, using static fallback: %s", exc)
            background = await self._load_fallback(context.image_prompt_en, context.negative_prompt_en)
            status = FlyerStatus.FALLBACK_USED
        except Exception as exc:
            logger.warning("ImageGen failed, switching to static fallback: %s", exc)
            background = await self._load_fallback(context.image_prompt_en, context.negative_prompt_en)
            status = FlyerStatus.FALLBACK_USED

        try:
            image_bytes = self._renderer.render_flyer(
                background_bytes=background,
                request=request,
                context=context,
            )
        except FlyerAppException:
            raise
        except Exception as exc:
            raise FontRenderError("フォントまたは描画に失敗しました") from exc

        flyer_id = str(uuid4())
        image_url = self._storage.save_temporary(flyer_id, image_bytes)
        return FlyerGenerationResponse(
            status=status,
            generation_id=flyer_id,
            image_url=image_url,
        )

    def save_selected(self, image_bytes: bytes) -> FlyerGenerationResponse:
        """ウィザードで選ばれた完成画像を、そのまま一時保存する。

        背景生成も文字合成もしない。候補を作った時点の見た目がそのまま残る。
        """
        flyer_id = str(uuid4())
        image_url = self._storage.save_temporary(flyer_id, image_bytes)
        return FlyerGenerationResponse(
            status=FlyerStatus.SUCCESS,
            generation_id=flyer_id,
            image_url=image_url,
        )

    async def _load_fallback(self, prompt: str, negative_prompt: str) -> bytes:
        return await self._fallback_images.generate_background(
            prompt=prompt,
            negative_prompt=negative_prompt,
            aspect_ratio="9:16",
        )
