FROM python:3.14.6-slim-bookworm

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

RUN apt-get update \
    && apt-get install --no-install-recommends -y tesseract-ocr tesseract-ocr-eng \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY services/api/pyproject.toml services/api/README.md ./
COPY services/api/app ./app
COPY assets/fonts ./assets/fonts
RUN pip install --no-cache-dir .

RUN groupadd --system ink && useradd --system --gid ink --create-home ink \
    && mkdir -p /app/data/storage \
    && chown -R ink:ink /app
USER ink

EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/ready', timeout=3)"

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers"]
