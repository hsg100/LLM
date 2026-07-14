FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

RUN apt-get update && apt-get install -y --no-install-recommends \
    git build-essential libpq-dev \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Build context is the REPOSITORY ROOT (compose: context: . ,
# dockerfile: apps/api/Dockerfile) so the curriculum catalogue can ship in
# the image. The root .dockerignore keeps the context lean.
COPY apps/api/pyproject.toml ./
RUN pip install --upgrade pip && pip install -e .

COPY apps/api/ ./

# Compiled curriculum artifacts live OUTSIDE /app so the development bind
# mount of ./apps/api:/app can never shadow them (design §5.2/§5.3). The
# grading catalogue exists only in this image — never in the web deployment.
COPY curriculum/build/catalog.json         /curriculum/build/catalog.json
COPY curriculum/build/catalog.grading.json /curriculum/build/catalog.grading.json

EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
