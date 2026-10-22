# syntax=docker/dockerfile:1

# AI チラシ生成サービス（FastAPI + Pillow + OpenAI）。
# 描画は日本語フォントを読むため、fonts-noto-cjk が必須。
# 無いと FontResolver.path_for が FontRenderError を投げ、生成が全て 500 になる。

FROM python:3.12-slim AS base
WORKDIR /app
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    TZ=Asia/Tokyo

# /usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc と
# NotoSerifCJK-Regular.ttc が入る。pillow_renderer.py の候補パスと一致する。
# fonts-noto-cjk-extra（全ウェイト・約 214MB）は不要。
RUN apt-get update \
  && apt-get install -y --no-install-recommends fonts-noto-cjk \
  && rm -rf /var/lib/apt/lists/*

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# 保存先はイメージに焼かずボリュームへ逃がす。pydantic-settings は
# 環境変数名の大文字小文字を区別しないので STORAGE_DIR で storage_dir に入る。
ENV STORAGE_DIR=/data/tmp \
    CANDIDATE_DIR=/data/candidates \
    FALLBACK_DIR=/data/backgrounds
RUN mkdir -p /data/tmp /data/candidates /data/backgrounds

EXPOSE 8000

# 開発用。compose がソースを bind mount する。
FROM base AS dev
CMD ["python", "-m", "uvicorn", "src.main:app", "--host", "0.0.0.0", "--port", "8000", "--reload"]

# 本番相当。
FROM base AS runtime
CMD ["python", "-m", "uvicorn", "src.main:app", "--host", "0.0.0.0", "--port", "8000"]
