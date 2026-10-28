"""FastAPI アプリケーションの組み立て。"""

from __future__ import annotations

import asyncio
import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager, suppress

from fastapi import FastAPI

from src.adapters.image_generator.static_fallback_image_generator import (
    StaticFallbackImageGenerator,
)
from src.adapters.renderer.pillow_renderer import PillowFlyerRenderer
from src.adapters.wiring import (
    ai_candidates_enabled,
    build_candidate_source,
    build_image_generator,
    build_image_upload,
    build_prompt_engine,
)
from src.api.errors import register_exception_handlers
from src.api.routes import router
from src.infrastructure.config import Settings
from src.infrastructure.quota.memory_ai_quota import MemoryAiGenerationQuota
from src.infrastructure.storage.local_candidate_store import LocalCandidateStore
from src.infrastructure.storage.local_file_storage import LocalFileStorage
from src.ports.ai_generation_quota_port import AiGenerationQuotaPort
from src.ports.candidate_source_port import CandidateSourcePort
from src.ports.image_generator_port import ImageGeneratorPort
from src.ports.prompt_engine_port import PromptEnginePort
from src.ports.renderer_port import FlyerRendererPort
from src.usecases.generate_flyer_usecase import GenerateFlyerUseCase
from src.usecases.propose_candidates_usecase import ProposeCandidatesUseCase

logger = logging.getLogger(__name__)


async def _cleanup_loop(app: FastAPI, stop: asyncio.Event) -> None:
    settings: Settings = app.state.settings
    storage: LocalFileStorage = app.state.storage
    candidates: LocalCandidateStore = app.state.candidate_store
    while not stop.is_set():
        try:
            removed = storage.cleanup_expired(settings.ttl_seconds)
            if removed:
                logger.info("removed %s expired flyer files", removed)
        except Exception:
            logger.exception("temporary file cleanup failed")
        try:
            removed = candidates.cleanup_expired(settings.candidate_ttl_seconds)
            if removed:
                logger.info("removed %s expired candidate files", removed)
        except Exception:
            logger.exception("candidate file cleanup failed")
        try:
            await asyncio.wait_for(stop.wait(), timeout=settings.cleanup_interval_seconds)
        except TimeoutError:
            continue


@asynccontextmanager
async def _lifespan(app: FastAPI) -> AsyncIterator[None]:
    stop = asyncio.Event()
    task = asyncio.create_task(_cleanup_loop(app, stop))
    try:
        yield
    finally:
        stop.set()
        task.cancel()
        with suppress(asyncio.CancelledError):
            await task


def create_app(
    settings: Settings | None = None,
    prompt_engine: PromptEnginePort | None = None,
    image_generator: ImageGeneratorPort | None = None,
    renderer: FlyerRendererPort | None = None,
    candidate_source: CandidateSourcePort | None = None,
    ai_quota: AiGenerationQuotaPort | None = None,
) -> FastAPI:
    resolved = settings if settings is not None else Settings()
    storage = LocalFileStorage(
        resolved.storage_dir,
        free_ratio_threshold=resolved.disk_free_ratio_threshold,
    )
    candidate_store = LocalCandidateStore(resolved.candidate_dir)
    fallback = StaticFallbackImageGenerator(resolved.fallback_dir)
    engine = prompt_engine or build_prompt_engine(resolved)
    images = image_generator or build_image_generator(resolved, fallback=fallback)
    drawing = renderer or PillowFlyerRenderer()
    sources = candidate_source or build_candidate_source(resolved)
    uploads = build_image_upload(resolved)
    quota = ai_quota or MemoryAiGenerationQuota(
        resolved.ai_candidate_max_per_hour,
        resolved.candidate_ttl_seconds,
    )
    _log_ai_candidates(resolved)

    app = FastAPI(title="AI Flyer Generator", lifespan=_lifespan)
    app.state.settings = resolved
    app.state.storage = storage
    app.state.candidate_store = candidate_store
    app.state.use_case = GenerateFlyerUseCase(
        prompt_engine=engine,
        image_generator=images,
        renderer=drawing,
        storage=storage,
        fallback_images=fallback,
    )
    app.state.candidates = ProposeCandidatesUseCase(
        prompt_engine=engine,
        source=sources,
        renderer=drawing,
        store=candidate_store,
        uploads=uploads,
        ai_quota=quota,
    )
    register_exception_handlers(app)
    app.include_router(router)
    return app


def _log_ai_candidates(settings: Settings) -> None:
    """採用した背景の供給元を 1 度だけ出す。付け忘れと切り忘れに気づけるようにする。"""
    if ai_candidates_enabled(settings):
        logger.info(
            "AI 背景候補: 有効 model=%s quality=%s 上限=%s枚/%s秒",
            settings.openai_image_model,
            settings.image_quality,
            settings.ai_candidate_max_per_hour,
            settings.candidate_ttl_seconds,
        )
        return
    if settings.ai_candidates_enabled:
        logger.warning(
            "AI_CANDIDATES_ENABLED が有効ですが OPENAI_API_KEY が空です。"
            "背景はグラデーションで生成します"
        )
        return
    logger.info("AI 背景候補: 無効（グラデーションで生成します）")


app = create_app()
