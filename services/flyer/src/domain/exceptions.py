"""アプリケーション固有の例外階層。

詳細設計書のエラーマトリクスに対応する。画像生成の失敗は呼び出し側が
捕捉して静的背景へ切り替える前提であり、ここでは握りつぶさない。
"""

from __future__ import annotations


class FlyerAppException(Exception):
    """本システムの基底例外。"""

    error_code: str = "INTERNAL_ERROR"
    http_status: int = 500
    default_user_message: str = (
        "ただいま生成が混み合っています。少し時間をおいてお試しください。"
    )

    def __init__(self, message: str, *, user_message: str | None = None) -> None:
        super().__init__(message)
        self.user_message = (
            self.default_user_message if user_message is None else user_message
        )


class InputValidationError(FlyerAppException):
    """入力文字数超過・形式不正。HTTP 422 / INVALID_INPUT。"""

    error_code = "INVALID_INPUT"
    http_status = 422
    default_user_message = "入力内容を確認してください（文字数超過など）"


class CandidateNotFoundError(FlyerAppException):
    """候補画像が見つからない、TTL 切れ、または所有者が違う。

    HTTP 404 / CANDIDATE_EXPIRED。所有者が違うときも、候補の存在自体を
    悟らせないために同じ応答にする。
    """

    error_code = "CANDIDATE_EXPIRED"
    http_status = 404
    default_user_message = "候補の有効期限が切れました。選び直してください。"


class ImageUploadError(InputValidationError):
    """アップロード画像の形式不正・破損。HTTP 422 / INVALID_IMAGE。"""

    error_code = "INVALID_IMAGE"
    http_status = 422
    default_user_message = (
        "画像を読み込めませんでした。JPEG / PNG / WebP の画像を選んでください。"
    )


class ImageTooLargeError(FlyerAppException):
    """アップロード画像が上限を超える。HTTP 413 / UPLOAD_TOO_LARGE。"""

    error_code = "UPLOAD_TOO_LARGE"
    http_status = 413
    default_user_message = "画像は8MB以下にしてください。"


class LLMContextGenerationError(FlyerAppException):
    """LLM の障害または構造化出力の解釈失敗。HTTP 503。"""

    error_code = "LLM_SERVICE_UNAVAILABLE"
    http_status = 503
    default_user_message = (
        "システム混雑のため処理を開始できませんでした。再試行してください"
    )


class ImageGenerationTimeoutError(FlyerAppException):
    """画像生成 API が制限時間内に完了しなかった。

    オーケストレーターはこれを利用者へ返さず、静的背景で合成を完遂する。
    """

    error_code = "FALLBACK_APPLIED"
    http_status = 200
    default_user_message = ""


class RenderingError(FlyerAppException):
    """文字合成の失敗。HTTP 500 / RENDER_FAILURE。"""

    error_code = "RENDER_FAILURE"
    http_status = 500
    default_user_message = "画像の文字合成に失敗しました。管理者に問い合わせてください"


class FontRenderError(RenderingError):
    """フォント読み込みまたは字形描画の失敗。RenderingError として 500 を返す。"""
