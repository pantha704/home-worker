"""Restart-safe leased OCR worker and retention cleanup."""

from __future__ import annotations

import asyncio
import hashlib
import logging
import tempfile
import uuid
from pathlib import Path

from fastapi.concurrency import run_in_threadpool

from .analyzer import analyze_pages
from .config import Settings
from .db import JobTask, ProjectRepository
from .errors import InkError
from .extraction import enforce_total_text_limit, extract_document
from .ingestion import EXTENSIONS
from .models import ProjectStatus
from .service import complete_processing, fail_processing
from .storage import ObjectStore

logger = logging.getLogger("homeworker.worker")


def _sha256_file(path: Path) -> tuple[int, str]:
    digest = hashlib.sha256()
    size = 0
    with path.open("rb") as source:
        while chunk := source.read(1024 * 1024):
            digest.update(chunk)
            size += len(chunk)
    return size, digest.hexdigest()


def process_job(
    task: JobTask,
    worker_id: str,
    repository: ProjectRepository,
    object_store: ObjectStore,
    settings: Settings,
) -> None:
    source = repository.get_source(task.owner_id, task.project_id)
    if source.project.status != ProjectStatus.PROCESSING:
        repository.complete_job(task.id, worker_id)
        return

    settings.work_root.mkdir(parents=True, exist_ok=True)
    suffix = EXTENSIONS[source.mime_type]
    with tempfile.TemporaryDirectory(prefix="homeworker-job-", dir=settings.work_root) as raw:
        path = Path(raw) / f"source{suffix}"
        object_store.get_to_path(source.source_key, path)
        actual_size, actual_digest = _sha256_file(path)
        if actual_size != source.source_size or actual_digest != source.project.sha256:
            raise InkError(
                "SOURCE_INTEGRITY_FAILED",
                "The private source bytes no longer match the project record.",
                status_code=503,
            )
        pages = extract_document(path, source.mime_type, settings)
        pages = analyze_pages(pages, settings)
        enforce_total_text_limit(pages, settings)
        complete_processing(
            repository,
            task.owner_id,
            task.project_id,
            source.project.revision,
            pages,
            job_lease=(task.id, worker_id),
        )


def _record_final_failure(
    task: JobTask,
    repository: ProjectRepository,
    error: Exception,
) -> None:
    try:
        project = repository.get(task.owner_id, task.project_id)
    except InkError:
        return
    if project.status != ProjectStatus.PROCESSING:
        return
    if isinstance(error, InkError):
        code = error.code
        message = error.message
    else:
        code = "PROCESSING_FAILED"
        message = "Document processing could not be completed after safe retries."
    try:
        fail_processing(
            repository,
            task.owner_id,
            task.project_id,
            project.revision,
            code,
            message,
        )
    except InkError:
        logger.warning("processing failure state changed before it could be recorded")


def run_worker_once(
    repository: ProjectRepository,
    object_store: ObjectStore,
    settings: Settings,
    worker_id: str,
) -> bool:
    task = repository.claim_job(worker_id, settings.job_lease_seconds)
    if task is None:
        return False
    try:
        process_job(task, worker_id, repository, object_store, settings)
    except Exception as exc:
        logger.exception("document processing attempt failed", exc_info=exc)
        failed = repository.retry_or_fail_job(
            task.id, worker_id, str(exc), settings.job_max_attempts
        )
        if failed:
            _record_final_failure(task, repository, exc)
    return True


def cleanup_expired(repository: ProjectRepository, object_store: ObjectStore) -> int:
    removed = 0
    pending = repository.pending_object_deletions()
    if pending:
        object_store.delete(pending)
        repository.complete_object_deletions(pending)
    for project in repository.expired_projects():
        object_keys = repository.delete_expired(project.owner_id, project.project_id)
        if object_keys:
            object_store.delete(object_keys)
            repository.complete_object_deletions(object_keys)
            removed += 1
    repository.prune_rate_limits()
    return removed


async def worker_loop(
    repository: ProjectRepository,
    object_store: ObjectStore,
    settings: Settings,
) -> None:
    worker_id = f"worker-{uuid.uuid4().hex[:12]}"
    idle_cycles = 0
    while True:
        handled = await run_in_threadpool(
            run_worker_once,
            repository,
            object_store,
            settings,
            worker_id,
        )
        idle_cycles = 0 if handled else idle_cycles + 1
        if idle_cycles >= 60:
            try:
                await run_in_threadpool(cleanup_expired, repository, object_store)
            except Exception as exc:
                logger.exception("retention cleanup failed", exc_info=exc)
            idle_cycles = 0
        if not handled:
            await asyncio.sleep(settings.job_poll_seconds)
