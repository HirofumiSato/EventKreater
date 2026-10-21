"""チラシ生成とダウンロード、ウィザード候補のエンドポイント。"""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import Response

from src.domain.exceptions import InputValidationError
from src.domain.models import (
    CandidateList,
    CandidateProposalCommand,
    FlyerGenerateCommand,
    FlyerGenerationRequest,
    FlyerGenerationResponse,
)
from src.infrastructure.storage.local_file_storage import LocalFileStorage
from src.usecases.generate_flyer_usecase import GenerateFlyerUseCase
from src.usecases.propose_candidates_usecase import ProposeCandidatesUseCase

router = APIRouter()


def _candidates(request: Request) -> ProposeCandidatesUseCase:
    return request.app.state.candidates


@router.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@router.post(
    "/api/v1/flyers/candidates/types",
    response_model=CandidateList,
)
async def candidate_types(
    body: FlyerGenerationRequest,
    request: Request,
) -> CandidateList:
    """ステップ 1。3 テンプレートの完成イメージを返す。"""
    return await _candidates(request).suggest_types(body)


@router.post("/api/v1/flyers/candidates", response_model=CandidateList)
async def candidate_backgrounds(
    body: CandidateProposalCommand,
    request: Request,
) -> CandidateList:
    """ステップ 2。選んだタイプの背景タイルを返す。"""
    return await _candidates(request).suggest_backgrounds(body, body.count)


@router.post(
    "/api/v1/flyers/candidates/{candidate_id}/layouts",
    response_model=CandidateList,
)
async def candidate_layouts(
    candidate_id: str,
    request: Request,
) -> CandidateList:
    """ステップ 3。同じ背景で 4 通りの文字配置を返す。"""
    return _candidates(request).suggest_layouts(candidate_id)


@router.post(
    "/api/v1/flyers/candidates/{candidate_id}/palettes",
    response_model=CandidateList,
)
async def candidate_palettes(
    candidate_id: str,
    request: Request,
) -> CandidateList:
    """ステップ 4。選んだ配置のまま 4 通りの配色を返す。"""
    return _candidates(request).suggest_palettes(candidate_id)


@router.get("/api/v1/flyers/candidates/{candidate_id}")
async def candidate_image(candidate_id: str, request: Request) -> Response:
    """候補画像。BFF がブラウザへ中継する。"""
    store = request.app.state.candidate_store
    payload = store.load(candidate_id)
    return Response(
        content=payload,
        media_type="image/jpeg",
        headers={"Cache-Control": "private, max-age=3600"},
    )


@router.post(
    "/api/v1/flyers/generate",
    response_model=FlyerGenerationResponse,
)
async def generate_flyer(
    body: FlyerGenerateCommand,
    request: Request,
) -> FlyerGenerationResponse:
    use_case: GenerateFlyerUseCase = request.app.state.use_case
    if body.candidate_id is not None:
        image_bytes, _ = _candidates(request).finalize(body.candidate_id)
        return use_case.save_selected(image_bytes)
    return await use_case.execute(body)


@router.get("/api/v1/flyers/{flyer_id}")
async def download_flyer(flyer_id: str, request: Request) -> Response:
    storage: LocalFileStorage = request.app.state.storage
    try:
        payload = storage.load(flyer_id)
    except FileNotFoundError as exc:
        raise HTTPException(
            status_code=404,
            detail="指定されたチラシは存在しないか、期限切れです",
        ) from exc
    except InputValidationError:
        raise
    return Response(
        content=payload,
        media_type="image/jpeg",
        headers={"Content-Disposition": f'inline; filename="{flyer_id}.jpg"'},
    )
