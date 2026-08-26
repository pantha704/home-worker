"""Environment-backed configuration with safe local and fail-closed hosted profiles."""

from __future__ import annotations

import os
import re
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import urlparse


def _env_int(name: str, default: int) -> int:
    try:
        return int(os.getenv(name, str(default)))
    except ValueError as exc:
        raise ValueError(f"{name} must be an integer") from exc


def _env_float(name: str, default: float) -> float:
    try:
        return float(os.getenv(name, str(default)))
    except ValueError as exc:
        raise ValueError(f"{name} must be a number") from exc


def _env_bool(name: str, default: bool) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    value = raw.strip().lower()
    if value in {"1", "true", "yes", "on"}:
        return True
    if value in {"0", "false", "no", "off"}:
        return False
    raise ValueError(f"{name} must be true or false")


def _required(name: str) -> str:
    value = os.getenv(name, "").strip()
    if not value:
        raise ValueError(f"{name} is required in hosted mode")
    return value


def _https_origin(value: str, name: str) -> str:
    parsed = urlparse(value)
    if parsed.scheme != "https" or not parsed.netloc or parsed.path not in {"", "/"}:
        raise ValueError(f"{name} must be an HTTPS origin without a path")
    return value.rstrip("/")


@dataclass(frozen=True, slots=True)
class Settings:
    """Runtime settings; local mode remains keyless and hosted mode fails closed."""

    app_env: str = "development"
    allow_test_backends: bool = False
    runtime_mode: str = "local"
    database_url: str = "sqlite:///./data/homeworker.db"
    database_schema: str = "homeworker"
    storage_provider: str = "local"
    storage_root: Path = Path("./data/storage")
    work_root: Path = Path("./data/work")
    cors_origins: tuple[str, ...] = ("http://localhost:3000",)
    supabase_url: str = ""
    supabase_publishable_key: str = ""
    supabase_secret_key: str = ""
    supabase_storage_bucket: str = "homeworker-private"
    processing_mode: str = "inline"
    start_worker: bool = True
    max_upload_bytes: int = 25 * 1024 * 1024
    max_pdf_pages: int = 100
    max_image_pixels: int = 40_000_000
    max_extracted_chars_per_page: int = 2_000_000
    max_total_extracted_chars: int = 5_000_000
    max_artifact_bytes: int = 20 * 1024 * 1024
    max_projects_per_user: int = 20
    max_user_storage_bytes: int = 100 * 1024 * 1024
    max_project_revisions: int = 60
    upload_rate_per_hour: int = 20
    mutation_rate_per_hour: int = 240
    retention_days: int = 14
    job_lease_seconds: int = 180
    job_poll_seconds: float = 1.0
    job_max_attempts: int = 3
    ocr_dpi: int = 200
    ocr_timeout_seconds: int = 30
    ocr_languages: str = "eng"
    low_confidence_threshold: float = 0.80
    analyzer_provider: str = "rules"
    ollama_base_url: str = "http://127.0.0.1:11434"
    ollama_model: str = "qwen3:4b"
    ollama_timeout_seconds: int = 20

    def __post_init__(self) -> None:
        positive = {
            "max_upload_bytes": self.max_upload_bytes,
            "max_pdf_pages": self.max_pdf_pages,
            "max_image_pixels": self.max_image_pixels,
            "max_extracted_chars_per_page": self.max_extracted_chars_per_page,
            "max_total_extracted_chars": self.max_total_extracted_chars,
            "max_artifact_bytes": self.max_artifact_bytes,
            "max_projects_per_user": self.max_projects_per_user,
            "max_user_storage_bytes": self.max_user_storage_bytes,
            "max_project_revisions": self.max_project_revisions,
            "upload_rate_per_hour": self.upload_rate_per_hour,
            "mutation_rate_per_hour": self.mutation_rate_per_hour,
            "retention_days": self.retention_days,
            "job_lease_seconds": self.job_lease_seconds,
            "job_poll_seconds": self.job_poll_seconds,
            "job_max_attempts": self.job_max_attempts,
        }
        invalid = [name for name, value in positive.items() if value <= 0]
        if invalid:
            raise ValueError(f"settings must be positive: {', '.join(sorted(invalid))}")
        if not 0 < self.low_confidence_threshold < 1:
            raise ValueError("INK_LOW_CONFIDENCE_THRESHOLD must be between 0 and 1")

    @property
    def hosted(self) -> bool:
        return self.runtime_mode == "hosted"

    @classmethod
    def from_env(cls) -> Settings:
        runtime_mode = os.getenv("INK_RUNTIME_MODE", "local").strip().lower()
        if runtime_mode not in {"local", "hosted"}:
            raise ValueError("INK_RUNTIME_MODE must be 'local' or 'hosted'")

        hosted = runtime_mode == "hosted"
        analyzer_provider = os.getenv("ANALYZER_PROVIDER", "rules").strip().lower()
        if analyzer_provider not in {"rules", "ollama"}:
            raise ValueError("ANALYZER_PROVIDER must be 'rules' or 'ollama'")

        storage_provider = (
            os.getenv("INK_STORAGE_PROVIDER", "supabase" if hosted else "local").strip().lower()
        )
        if storage_provider not in {"local", "supabase"}:
            raise ValueError("INK_STORAGE_PROVIDER must be 'local' or 'supabase'")

        processing_mode = (
            os.getenv("INK_PROCESSING_MODE", "worker" if hosted else "inline").strip().lower()
        )
        if processing_mode not in {"inline", "worker"}:
            raise ValueError("INK_PROCESSING_MODE must be 'inline' or 'worker'")

        default_origins = "" if hosted else "http://localhost:3000"
        origins = tuple(
            origin.strip().rstrip("/")
            for origin in os.getenv("INK_CORS_ORIGINS", default_origins).split(",")
            if origin.strip()
        )
        if not origins or "*" in origins:
            raise ValueError("INK_CORS_ORIGINS must contain explicit origins")

        database_schema = os.getenv("INK_DATABASE_SCHEMA", "homeworker").strip()
        if not re.fullmatch(r"[a-z][a-z0-9_]{0,62}", database_schema):
            raise ValueError("INK_DATABASE_SCHEMA must be a lowercase PostgreSQL identifier")

        database_url = os.getenv("INK_DATABASE_URL", "sqlite:///./data/homeworker.db").strip()
        supabase_url = os.getenv("SUPABASE_URL", "").strip().rstrip("/")
        publishable_key = os.getenv("SUPABASE_PUBLISHABLE_KEY", "").strip()
        secret_key = os.getenv("SUPABASE_SECRET_KEY", "").strip()
        start_worker = _env_bool("INK_START_WORKER", True)

        if hosted:
            database_url = _required("INK_DATABASE_URL")
            if not database_url.startswith(("postgresql://", "postgresql+psycopg://")):
                raise ValueError("hosted mode requires a PostgreSQL connection URL")
            if storage_provider != "supabase":
                raise ValueError("hosted mode requires INK_STORAGE_PROVIDER=supabase")
            if processing_mode != "worker":
                raise ValueError("hosted mode requires INK_PROCESSING_MODE=worker")
            if not start_worker:
                raise ValueError("hosted mode requires INK_START_WORKER=true")
            supabase_url = _https_origin(_required("SUPABASE_URL"), "SUPABASE_URL")
            publishable_key = _required("SUPABASE_PUBLISHABLE_KEY")
            secret_key = _required("SUPABASE_SECRET_KEY")
            if secret_key == publishable_key:
                raise ValueError("SUPABASE_SECRET_KEY must not be the browser publishable key")
            for origin in origins:
                _https_origin(origin, "INK_CORS_ORIGINS entry")

        return cls(
            app_env=os.getenv("INK_APP_ENV", "development").strip().lower(),
            runtime_mode=runtime_mode,
            database_url=database_url,
            database_schema=database_schema,
            storage_provider=storage_provider,
            storage_root=Path(os.getenv("INK_STORAGE_ROOT", "./data/storage")),
            work_root=Path(os.getenv("INK_WORK_ROOT", "./data/work")),
            cors_origins=origins,
            supabase_url=supabase_url,
            supabase_publishable_key=publishable_key,
            supabase_secret_key=secret_key,
            supabase_storage_bucket=os.getenv(
                "SUPABASE_STORAGE_BUCKET", "homeworker-private"
            ).strip(),
            processing_mode=processing_mode,
            start_worker=start_worker,
            max_upload_bytes=_env_int(
                "INK_MAX_UPLOAD_BYTES", 10 * 1024 * 1024 if hosted else 25 * 1024 * 1024
            ),
            max_pdf_pages=_env_int("INK_MAX_PDF_PAGES", 30 if hosted else 100),
            max_image_pixels=_env_int("INK_MAX_IMAGE_PIXELS", 40_000_000),
            max_extracted_chars_per_page=_env_int(
                "INK_MAX_EXTRACTED_CHARS_PER_PAGE", 300_000 if hosted else 2_000_000
            ),
            max_total_extracted_chars=_env_int(
                "INK_MAX_TOTAL_EXTRACTED_CHARS", 1_000_000 if hosted else 5_000_000
            ),
            max_artifact_bytes=_env_int("INK_MAX_ARTIFACT_BYTES", 20 * 1024 * 1024),
            max_projects_per_user=_env_int("INK_MAX_PROJECTS_PER_USER", 20),
            max_user_storage_bytes=_env_int("INK_MAX_USER_STORAGE_BYTES", 100 * 1024 * 1024),
            max_project_revisions=_env_int("INK_MAX_PROJECT_REVISIONS", 60),
            upload_rate_per_hour=_env_int("INK_UPLOAD_RATE_PER_HOUR", 20),
            mutation_rate_per_hour=_env_int("INK_MUTATION_RATE_PER_HOUR", 240),
            retention_days=_env_int("INK_RETENTION_DAYS", 14),
            job_lease_seconds=_env_int("INK_JOB_LEASE_SECONDS", 180),
            job_poll_seconds=_env_float("INK_JOB_POLL_SECONDS", 1.0),
            job_max_attempts=_env_int("INK_JOB_MAX_ATTEMPTS", 3),
            ocr_dpi=_env_int("INK_OCR_DPI", 180 if hosted else 200),
            ocr_timeout_seconds=_env_int("INK_OCR_TIMEOUT_SECONDS", 30),
            ocr_languages=os.getenv("INK_OCR_LANGUAGES", "eng"),
            low_confidence_threshold=_env_float("INK_LOW_CONFIDENCE_THRESHOLD", 0.80),
            analyzer_provider=analyzer_provider,
            ollama_base_url=os.getenv("OLLAMA_BASE_URL", "http://127.0.0.1:11434").rstrip("/"),
            ollama_model=os.getenv("OLLAMA_MODEL", "qwen3:4b"),
            ollama_timeout_seconds=_env_int("OLLAMA_TIMEOUT_SECONDS", 20),
        )
