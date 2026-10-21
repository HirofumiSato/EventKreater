"""ドメインモデルのバリデーションと例外階層。"""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from src.domain.exceptions import (
    CandidateNotFoundError,
    FlyerAppException,
    FontRenderError,
    ImageGenerationTimeoutError,
    InputValidationError,
    LLMContextGenerationError,
    RenderingError,
)
from src.domain.models import (
    FlyerGenerationRequest,
    LLMGenerationContext,
    RainPolicy,
    TemplateId,
)


def _payload(**overrides: object) -> dict[str, object]:
    data: dict[str, object] = {
        "title": "ジャズの夜",
        "event_date": "2026年11月15日(日)",
        "event_time": "19:00〜22:00",
        "price": "3,000円",
        "location": "Jazz Bar MOON",
        "template_id": TemplateId.STYLE_1_BAR_STYLISH,
    }
    data.update(overrides)
    return data


def test_title_strips_whitespace_and_newlines() -> None:
    request = FlyerGenerationRequest.model_validate(_payload(title="  ジャズ\nナイト  "))
    assert request.title == "ジャズ ナイト"
    assert request.rain_policy is RainPolicy.RAIN_OR_SHINE
    assert request.capacity is None


def test_blank_capacity_becomes_none() -> None:
    request = FlyerGenerationRequest.model_validate(_payload(capacity="  \n "))
    assert request.capacity is None


def test_length_limits_reject_overflow() -> None:
    with pytest.raises(ValidationError):
        FlyerGenerationRequest.model_validate(_payload(title="あ"))
    with pytest.raises(ValidationError):
        FlyerGenerationRequest.model_validate(_payload(title="あ" * 41))
    with pytest.raises(ValidationError):
        FlyerGenerationRequest.model_validate(_payload(location="場"))
    with pytest.raises(ValidationError):
        FlyerGenerationRequest.model_validate(_payload(capacity="あ" * 21))


def test_llm_context_rejects_invalid_color_and_alpha() -> None:
    with pytest.raises(ValidationError):
        LLMGenerationContext(
            image_prompt_en="soft light",
            negative_prompt_en="text",
            suggested_accent_color="amber",
            suggested_overlay_alpha=0.55,
        )
    with pytest.raises(ValidationError):
        LLMGenerationContext(
            image_prompt_en="soft light",
            negative_prompt_en="text",
            suggested_accent_color="#F59E0B",
            suggested_overlay_alpha=0.1,
        )


def test_exception_hierarchy_matches_error_matrix() -> None:
    assert issubclass(InputValidationError, FlyerAppException)
    assert issubclass(CandidateNotFoundError, FlyerAppException)
    assert issubclass(ImageGenerationTimeoutError, FlyerAppException)
    assert issubclass(RenderingError, FlyerAppException)
    assert issubclass(FontRenderError, RenderingError)
    assert issubclass(LLMContextGenerationError, FlyerAppException)
    assert InputValidationError("bad").http_status == 422
    assert CandidateNotFoundError("gone").http_status == 404
    assert LLMContextGenerationError("llm").http_status == 503
    assert RenderingError("render").http_status == 500
    assert InputValidationError("bad").error_code == "INVALID_INPUT"
    assert CandidateNotFoundError("gone").error_code == "CANDIDATE_EXPIRED"
