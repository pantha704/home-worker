"""FastAPI application for keyless local use and the fail-closed hosted profile."""

from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import re
import tempfile
import time
import uuid
from collections.abc import AsyncIterator, Awaitable, Callable
from contextlib import asynccontextmanager, suppress
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Annotated, Literal, cast

from fastapi import Depends, FastAPI, File, Header, Query, Request, UploadFile, status
from fastapi import Path as RoutePath
from fastapi.concurrency import run_in_threadpool
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from starlette.exceptions import HTTPException

from .analyzer import analyze_pages
from .auth import Identity, TokenVerifier, build_token_verifier, require_identity
from .config import Settings
from .db import ArtifactRecord, ProjectRepository, ProjectSource
from .errors import (
    InkError,
    http_error_handler,
    ink_error_handler,
    unexpected_error_handler,
    validation_error_handler,
)
from .extraction import enforce_total_text_limit, extract_document, rasterize_source_page
from .ingestion import EXTENSIONS, remove_project_storage, store_upload
from .models import (
    ArtifactManifest,
    BlockPatch,
    BlockReviewRequest,
    ConfirmRequest,
    HealthResponse,
    PageTextPatch,
    Persona,
    ProjectDocument,
    ProjectList,
    ProjectStatus,
    ReadinessResponse,
    RetryPagesRequest,
    SettingsPatch,
)
from .rendering import (
    personas,
    render_companion,
    render_companion_text,
    render_handwritten,
    render_handwritten_page_png,
)
from .service import (
    confirm_project,
    patch_block,
    patch_page_text,
    patch_settings,
    replace_extracted_pages,
    review_block,
)
from .storage import ObjectStore, artifact_object_key, build_object_store, source_object_key
from .worker import worker_loop

logger = logging.getLogger("homeworker.api")
REQUEST_ID_PATTERN = re.compile(r"^[A-Za-z0-9._-]{1,128}$")
MUTATING_METHODS = frozenset({"POST", "PATCH", "DELETE", "PUT"})
ArtifactKind = Literal["handwritten_pdf", "companion_pdf", "companion_text"]
IdentityDependency = Annotated[Identity, Depends(require_identity)]


def _parse_idempotency_key(raw: str | None) -> str | None:
    if raw is None:
        return None
    key = raw.strip()
    if key == "":
        return None
    if len(key) > 128 or any(ord(char) < 32 for char in key):
        raise InkError(
            "INVALID_IDEMPOTENCY_KEY",
            "Idempotency-Key must be 1-128 visible characters.",
            status_code=400,
        )
    return key


def _repository(request: Request) -> ProjectRepository:
    return cast(ProjectRepository, request.app.state.repository)


def _object_store(request: Request) -> ObjectStore:
    return cast(ObjectStore, request.app.state.object_store)


def _safe_download_name(filename: str, suffix: str, extension: str) -> str:
    stem = Path(filename).stem[:80] or "homeworker"
    stem = re.sub(r"[^A-Za-z0-9._-]", "-", stem).strip(".-") or "homeworker"
    return f"{stem}-{suffix}.{extension}"


def _artifact_spec(
    kind: ArtifactKind,
) -> tuple[Callable[[ProjectDocument], bytes], str, str, str]:
    if kind == "handwritten_pdf":
        return render_handwritten, "application/pdf", "pdf", "handwritten"
    if kind == "companion_pdf":
        return render_companion, "application/pdf", "pdf", "typed-companion"
    return render_companion_text, "text/plain; charset=utf-8", "txt", "typed-companion"


def _load_project_revision(
    repository: ProjectRepository,
    owner_id: str,
    project_id: str,
    revision: int | None,
) -> ProjectDocument:
    if revision is None:
        return repository.get(owner_id, project_id)
    return repository.get_revision(owner_id, project_id, revision)


def _artifact_bytes(
    repository: ProjectRepository,
    object_store: ObjectStore,
    settings: Settings,
    owner_id: str,
    project_id: str,
    revision: int | None,
    kind: ArtifactKind,
) -> tuple[ProjectDocument, ArtifactRecord, bytes]:
    project = _load_project_revision(repository, owner_id, project_id, revision)
    if project.status != ProjectStatus.READY:
        raise InkError(
            "REVIEW_INCOMPLETE",
            "Complete review for this exact revision before downloading final artifacts.",
            status_code=409,
        )
    existing = repository.get_artifact(owner_id, project_id, project.revision, kind)
    if existing is not None and existing.size <= settings.max_artifact_bytes:
        try:
            content = object_store.get_bytes(existing.object_key, existing.size)
        except InkError as exc:
            if exc.code not in {"OBJECT_NOT_FOUND", "OBJECT_SIZE_LIMIT_EXCEEDED"}:
                raise
        else:
            digest = hashlib.sha256(content).hexdigest()
            if len(content) == existing.size and digest == existing.sha256:
                return project, existing, content
        object_store.delete([existing.object_key])

    renderer, media_type, suffix, _download_suffix = _artifact_spec(kind)
    content = renderer(project)
    if len(content) > settings.max_artifact_bytes:
        raise InkError(
            "ARTIFACT_SIZE_LIMIT_EXCEEDED",
            "The generated artifact exceeds the free hosted profile's size limit.",
            status_code=413,
            details={"maxBytes": settings.max_artifact_bytes},
        )
    digest = hashlib.sha256(content).hexdigest()
    if existing is None:
        usage = repository.usage(owner_id)
        if usage.total_bytes + len(content) > settings.max_user_storage_bytes:
            raise InkError(
                "STORAGE_QUOTA_EXCEEDED",
                "This account reached its private storage allowance. Delete a project and retry.",
                status_code=409,
                details={"maxBytes": settings.max_user_storage_bytes},
            )
    key = artifact_object_key(
        owner_id,
        project_id,
        project.revision,
        kind,
        digest,
        suffix,
    )
    stored = object_store.put_bytes(key, content, media_type)
    if stored.sha256 != digest or stored.size != len(content):
        raise InkError(
            "ARTIFACT_INTEGRITY_FAILED",
            "The generated artifact could not be verified after private storage.",
            status_code=503,
        )
    try:
        record = repository.record_artifact(
            ArtifactRecord(
                project_id=project_id,
                revision=project.revision,
                kind=kind,
                owner_id=owner_id,
                object_key=key,
                sha256=digest,
                size=len(content),
                media_type=media_type,
                created_at=datetime.now(UTC),
            )
        )
    except Exception:
        object_store.delete([key])
        raise
    if record.object_key != key:
        content = object_store.get_bytes(record.object_key, record.size)
        if len(content) != record.size or hashlib.sha256(content).hexdigest() != record.sha256:
            raise InkError(
                "ARTIFACT_INTEGRITY_FAILED",
                "The cached artifact failed its integrity check.",
                status_code=503,
            )
    return project, record, content


def create_app(
    settings: Settings | None = None,
    *,
    token_verifier: TokenVerifier | None = None,
    object_store: ObjectStore | None = None,
) -> FastAPI:
    config = settings or Settings.from_env()
    repository = ProjectRepository(
        config.database_url,
        schema=config.database_schema,
        auto_create=not config.hosted or config.allow_test_backends,
        max_revisions=config.max_project_revisions,
        max_projects=config.max_projects_per_user,
        max_storage_bytes=config.max_user_storage_bytes,
    )
    store = object_store or build_object_store(config)
    verifier = token_verifier or build_token_verifier(config)

    @asynccontextmanager
    async def lifespan(application: FastAPI) -> AsyncIterator[None]:
        config.work_root.mkdir(parents=True, exist_ok=True)
        await run_in_threadpool(repository.initialize)
        await run_in_threadpool(store.ping)
        application.state.settings = config
        application.state.repository = repository
        application.state.object_store = store
        application.state.token_verifier = verifier
        task: asyncio.Task[None] | None = None
        if config.processing_mode == "worker" and config.start_worker:
            task = asyncio.create_task(worker_loop(repository, store, config))
        try:
            yield
        finally:
            if task is not None:
                task.cancel()
                with suppress(asyncio.CancelledError):
                    await task
            await run_in_threadpool(store.close)
            repository.engine.dispose()

    application = FastAPI(
        title="Homeworker API",
        version="0.2.0",
        summary="Faithful document review and deterministic A4 handwriting",
        lifespan=lifespan,
    )
    application.add_middleware(
        CORSMiddleware,
        allow_origins=list(config.cors_origins),
        allow_credentials=False,
        allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
        allow_headers=[
            "Accept",
            "Authorization",
            "Content-Type",
            "X-Homeworker-Client",
            "X-Request-ID",
        ],
        expose_headers=[
            "Content-Disposition",
            "X-Artifact-SHA256",
            "X-Project-Revision",
            "X-Project-Status",
            "X-Request-ID",
            "X-Storage-Cleanup",
        ],
    )
    application.add_exception_handler(InkError, ink_error_handler)  # type: ignore[arg-type]
    application.add_exception_handler(HTTPException, http_error_handler)  # type: ignore[arg-type]
    from fastapi.exceptions import RequestValidationError

    application.add_exception_handler(
        RequestValidationError,
        validation_error_handler,  # type: ignore[arg-type]
    )
    application.add_exception_handler(Exception, unexpected_error_handler)

    @application.middleware("http")
    async def request_context(
        request: Request, call_next: Callable[[Request], Awaitable[Response]]
    ) -> Response:
        supplied = request.headers.get("X-Request-ID", "")
        request_id = supplied if REQUEST_ID_PATTERN.fullmatch(supplied) else str(uuid.uuid4())
        request.state.request_id = request_id
        if (
            config.hosted
            and request.method in MUTATING_METHODS
            and request.url.path.startswith("/v1/")
        ):
            origin = request.headers.get("Origin", "").rstrip("/")
            if (
                origin not in config.cors_origins
                or request.headers.get("X-Homeworker-Client") != "web"
            ):
                return await ink_error_handler(
                    request,
                    InkError(
                        "UNTRUSTED_REQUEST_ORIGIN",
                        "This request did not come from the configured Homeworker site.",
                        status_code=403,
                    ),
                )
        started = time.perf_counter()
        response = await call_next(request)
        response.headers["X-Request-ID"] = request_id
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Referrer-Policy"] = "no-referrer"
        response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
        response.headers["Cross-Origin-Resource-Policy"] = "same-site"
        if request.url.path.startswith("/v1/"):
            response.headers.setdefault("Cache-Control", "private, no-store")
            response.headers["Vary"] = "Origin, Authorization"
        route = request.scope.get("route")
        route_path = getattr(route, "path", request.url.path)
        logger.info(
            json.dumps(
                {
                    "event": "http_request",
                    "requestId": request_id,
                    "method": request.method,
                    "route": route_path,
                    "status": response.status_code,
                    "durationMs": round((time.perf_counter() - started) * 1000, 2),
                },
                separators=(",", ":"),
            )
        )
        return response

    @application.get("/health", response_model=HealthResponse, tags=["operations"])
    async def health() -> HealthResponse:
        return HealthResponse()

    @application.get("/ready", response_model=ReadinessResponse, tags=["operations"])
    async def ready(request: Request) -> ReadinessResponse:
        try:
            await run_in_threadpool(_repository(request).ping)
            await run_in_threadpool(_object_store(request).ping)
        except (InkError, OSError, RuntimeError, SQLAlchemyError) as exc:
            raise InkError(
                "SERVICE_NOT_READY",
                "Database or private storage is unavailable.",
                status_code=503,
            ) from exc
        return ReadinessResponse()

    @application.post(
        "/v1/projects",
        response_model=ProjectDocument,
        status_code=status.HTTP_201_CREATED,
        tags=["projects"],
    )
    async def create_project(
        request: Request,
        identity: IdentityDependency,
        file: Annotated[UploadFile, File(description="PDF, PNG, or JPEG source document")],
        idempotency_key_header: Annotated[str | None, Header(alias="Idempotency-Key")] = None,
    ) -> ProjectDocument | JSONResponse:
        repository = _repository(request)
        store = _object_store(request)
        idempotency_key = _parse_idempotency_key(idempotency_key_header)

        stored = await store_upload(file, config)
        if idempotency_key:
            existing = await run_in_threadpool(
                repository.get_by_idempotency_key, identity.owner_id, idempotency_key
            )
            if existing is not None:
                await run_in_threadpool(remove_project_storage, config, stored.project_id)
                if existing.sha256 != stored.sha256:
                    raise InkError(
                        "IDEMPOTENCY_KEY_REUSE",
                        "That Idempotency-Key already created a different document.",
                        status_code=409,
                    )
                return JSONResponse(
                    status_code=200,
                    content=existing.model_dump(mode="json", by_alias=True),
                )

        await run_in_threadpool(
            repository.consume_rate,
            identity.owner_id,
            "upload",
            config.upload_rate_per_hour,
        )
        usage = await run_in_threadpool(repository.usage, identity.owner_id)
        if usage.project_count >= config.max_projects_per_user:
            raise InkError(
                "PROJECT_QUOTA_EXCEEDED",
                "This account reached its project limit. Delete a project and retry.",
                status_code=409,
                details={"maxProjects": config.max_projects_per_user},
            )

        key = source_object_key(
            identity.owner_id,
            stored.project_id,
            EXTENSIONS[stored.mime_type],
        )
        object_written = False
        try:
            if usage.total_bytes + stored.size > config.max_user_storage_bytes:
                raise InkError(
                    "STORAGE_QUOTA_EXCEEDED",
                    (
                        "This account reached its private storage allowance. "
                        "Delete a project and retry."
                    ),
                    status_code=409,
                    details={"maxBytes": config.max_user_storage_bytes},
                )
            saved = await run_in_threadpool(
                store.put_file,
                key,
                stored.path,
                stored.mime_type,
            )
            if saved.size != stored.size or saved.sha256 != stored.sha256:
                raise InkError(
                    "SOURCE_INTEGRITY_FAILED",
                    "The uploaded source could not be verified after private storage.",
                    status_code=503,
                )
            object_written = True
            now = datetime.now(UTC)
            enqueue = config.processing_mode == "worker"
            pages = []
            project_status = ProjectStatus.PROCESSING
            if not enqueue:
                pages = await run_in_threadpool(
                    extract_document,
                    stored.path,
                    stored.mime_type,
                    config,
                )
                pages = await run_in_threadpool(analyze_pages, pages, config)
                await run_in_threadpool(enforce_total_text_limit, pages, config)
                project_status = ProjectStatus.NEEDS_REVIEW
            project = ProjectDocument(
                id=stored.project_id,
                filename=stored.filename,
                mime_type=stored.mime_type,
                sha256=stored.sha256,
                status=project_status,
                revision=1,
                created_at=now,
                updated_at=now,
                pages=pages,
                error=None,
            )
            try:
                return await run_in_threadpool(
                    repository.create,
                    identity.owner_id,
                    project,
                    source_key=key,
                    source_size=stored.size,
                    expires_at=now + timedelta(days=config.retention_days),
                    enqueue=enqueue,
                    idempotency_key=idempotency_key,
                )
            except IntegrityError:
                replay = (
                    await run_in_threadpool(
                        repository.get_by_idempotency_key, identity.owner_id, idempotency_key
                    )
                    if idempotency_key
                    else None
                )
                if replay is None:
                    raise
                if replay.sha256 != stored.sha256:
                    raise InkError(
                        "IDEMPOTENCY_KEY_REUSE",
                        "That Idempotency-Key already created a different document.",
                        status_code=409,
                    ) from None
                await run_in_threadpool(store.delete, [key])
                object_written = False
                return JSONResponse(
                    status_code=200,
                    content=replay.model_dump(mode="json", by_alias=True),
                )
        except Exception:
            if object_written:
                with suppress(Exception):
                    await run_in_threadpool(store.delete, [key])
            raise
        finally:
            await run_in_threadpool(remove_project_storage, config, stored.project_id)

    @application.get("/v1/projects", response_model=ProjectList, tags=["projects"])
    async def list_projects(
        request: Request,
        identity: IdentityDependency,
        limit: Annotated[int, Query(ge=1, le=100)] = 25,
        offset: Annotated[int, Query(ge=0)] = 0,
    ) -> ProjectList:
        return await run_in_threadpool(
            _repository(request).list_projects,
            identity.owner_id,
            limit=limit,
            offset=offset,
        )

    @application.get("/v1/projects/{project_id}", response_model=ProjectDocument, tags=["projects"])
    async def get_project(
        request: Request, project_id: str, identity: IdentityDependency
    ) -> ProjectDocument:
        return await run_in_threadpool(_repository(request).get, identity.owner_id, project_id)

    @application.get(
        "/v1/projects/{project_id}/source.json",
        response_model=ProjectDocument,
        tags=["review"],
    )
    async def extraction_evidence(
        request: Request, project_id: str, identity: IdentityDependency
    ) -> ProjectDocument:
        return await run_in_threadpool(
            _repository(request).get_extraction_evidence,
            identity.owner_id,
            project_id,
        )

    @application.delete(
        "/v1/projects/{project_id}",
        status_code=status.HTTP_204_NO_CONTENT,
        tags=["projects"],
    )
    async def delete_project(
        request: Request,
        project_id: str,
        identity: IdentityDependency,
        expected_revision: Annotated[int, Query(alias="expectedRevision", ge=1)],
    ) -> Response:
        repository = _repository(request)
        await run_in_threadpool(
            repository.consume_rate,
            identity.owner_id,
            "mutation",
            config.mutation_rate_per_hour,
        )
        keys = await run_in_threadpool(
            repository.delete,
            identity.owner_id,
            project_id,
            expected_revision,
        )
        cleanup = "complete"
        try:
            await run_in_threadpool(_object_store(request).delete, keys)
            await run_in_threadpool(repository.complete_object_deletions, keys)
        except InkError:
            cleanup = "queued"
            logger.exception("private object cleanup queued for retry")
        return Response(
            status_code=status.HTTP_204_NO_CONTENT,
            headers={"X-Storage-Cleanup": cleanup},
        )

    async def _consume_mutation(request: Request, owner_id: str) -> None:
        await run_in_threadpool(
            _repository(request).consume_rate,
            owner_id,
            "mutation",
            config.mutation_rate_per_hour,
        )

    @application.patch(
        "/v1/projects/{project_id}/blocks/{block_id}",
        response_model=ProjectDocument,
        tags=["review"],
    )
    async def update_block(
        request: Request,
        project_id: str,
        block_id: str,
        patch: BlockPatch,
        identity: IdentityDependency,
    ) -> ProjectDocument:
        await _consume_mutation(request, identity.owner_id)
        return await run_in_threadpool(
            patch_block,
            _repository(request),
            identity.owner_id,
            project_id,
            block_id,
            patch,
        )

    @application.post(
        "/v1/projects/{project_id}/blocks/{block_id}/review",
        response_model=ProjectDocument,
        tags=["review"],
    )
    async def approve_block(
        request: Request,
        project_id: str,
        block_id: str,
        body: BlockReviewRequest,
        identity: IdentityDependency,
    ) -> ProjectDocument:
        await _consume_mutation(request, identity.owner_id)
        return await run_in_threadpool(
            review_block,
            _repository(request),
            identity.owner_id,
            project_id,
            block_id,
            body,
        )

    def _with_source_file(
        request: Request, owner_id: str, project_id: str
    ) -> tuple[ProjectSource, Path, tempfile.TemporaryDirectory[str]]:
        repository = _repository(request)
        store = _object_store(request)
        source = repository.get_source(owner_id, project_id)
        config.work_root.mkdir(parents=True, exist_ok=True)
        raw = tempfile.TemporaryDirectory(prefix="homeworker-page-", dir=config.work_root)
        path = Path(raw.name) / f"source{EXTENSIONS[source.mime_type]}"
        store.get_to_path(source.source_key, path)
        return source, path, raw

    @application.patch(
        "/v1/projects/{project_id}/pages/{page_number}",
        response_model=ProjectDocument,
        tags=["review"],
    )
    async def update_page_text(
        request: Request,
        project_id: str,
        page_number: Annotated[int, RoutePath(ge=1)],
        patch: PageTextPatch,
        identity: IdentityDependency,
    ) -> ProjectDocument:
        await _consume_mutation(request, identity.owner_id)
        return await run_in_threadpool(
            patch_page_text,
            _repository(request),
            identity.owner_id,
            project_id,
            page_number,
            patch,
        )

    @application.post(
        "/v1/projects/{project_id}/pages/retry",
        response_model=ProjectDocument,
        tags=["review"],
    )
    async def retry_pages(
        request: Request,
        project_id: str,
        body: RetryPagesRequest,
        identity: IdentityDependency,
    ) -> ProjectDocument:
        await _consume_mutation(request, identity.owner_id)

        def run() -> ProjectDocument:
            source, path, raw = _with_source_file(request, identity.owner_id, project_id)
            try:
                pages = extract_document(
                    path,
                    source.mime_type,
                    config,
                    page_numbers=set(body.page_numbers),
                    force_ocr=body.force_ocr,
                )
                pages = analyze_pages(pages, config)
                current = _repository(request).get(identity.owner_id, project_id)
                by_number = {page.number: page for page in pages}
                preview = [by_number.get(page.number, page) for page in current.pages]
                enforce_total_text_limit(preview, config)
                return replace_extracted_pages(
                    _repository(request),
                    identity.owner_id,
                    project_id,
                    body.expected_revision,
                    pages,
                )
            finally:
                raw.cleanup()

        return await run_in_threadpool(run)

    @application.get("/v1/projects/{project_id}/pages/{page_number}/source.png", tags=["review"])
    async def source_page_png(
        request: Request,
        project_id: str,
        page_number: Annotated[int, RoutePath(ge=1)],
        identity: IdentityDependency,
    ) -> Response:
        def run() -> bytes:
            _source, path, raw = _with_source_file(request, identity.owner_id, project_id)
            try:
                source = _repository(request).get_source(identity.owner_id, project_id)
                return rasterize_source_page(path, source.mime_type, page_number)
            finally:
                raw.cleanup()

        content = await run_in_threadpool(run)
        return Response(
            content=content,
            media_type="image/png",
            headers={"Cache-Control": "private, max-age=60"},
        )

    @application.get("/v1/projects/{project_id}/sheets/{page_number}.png", tags=["rendering"])
    async def handwritten_sheet_png(
        request: Request,
        project_id: str,
        page_number: Annotated[int, RoutePath(ge=1)],
        identity: IdentityDependency,
        revision: Annotated[int | None, Query(ge=1)] = None,
    ) -> Response:
        def run() -> bytes:
            project = _load_project_revision(
                _repository(request), identity.owner_id, project_id, revision
            )
            return render_handwritten_page_png(project, page_number)

        content = await run_in_threadpool(run)
        return Response(
            content=content, media_type="image/png", headers={"Cache-Control": "private, no-store"}
        )

    @application.post(
        "/v1/projects/{project_id}/confirm",
        response_model=ProjectDocument,
        tags=["review"],
    )
    async def confirm(
        request: Request,
        project_id: str,
        confirmation: ConfirmRequest,
        identity: IdentityDependency,
    ) -> ProjectDocument:
        await _consume_mutation(request, identity.owner_id)
        return await run_in_threadpool(
            confirm_project,
            _repository(request),
            identity.owner_id,
            project_id,
            confirmation,
        )

    @application.patch(
        "/v1/projects/{project_id}/settings",
        response_model=ProjectDocument,
        tags=["rendering"],
    )
    async def update_settings(
        request: Request,
        project_id: str,
        patch: SettingsPatch,
        identity: IdentityDependency,
    ) -> ProjectDocument:
        await _consume_mutation(request, identity.owner_id)
        return await run_in_threadpool(
            patch_settings,
            _repository(request),
            identity.owner_id,
            project_id,
            patch,
        )

    @application.get("/v1/personas", response_model=list[Persona], tags=["rendering"])
    async def list_personas() -> list[Persona]:
        return personas()

    async def artifact_response(
        request: Request,
        identity: Identity,
        project_id: str,
        revision: int | None,
        kind: ArtifactKind,
    ) -> Response:
        project, record, content = await run_in_threadpool(
            _artifact_bytes,
            _repository(request),
            _object_store(request),
            config,
            identity.owner_id,
            project_id,
            revision,
            kind,
        )
        _renderer, media_type, extension, suffix = _artifact_spec(kind)
        disposition = "attachment" if project.status == ProjectStatus.READY else "inline"
        return Response(
            content=content,
            media_type=media_type,
            headers={
                "Content-Disposition": (
                    f'{disposition}; filename="'
                    f'{_safe_download_name(project.filename, suffix, extension)}"'
                ),
                "Cache-Control": "private, no-store",
                "X-Artifact-SHA256": record.sha256,
                "X-Project-Revision": str(project.revision),
                "X-Project-Status": project.status.value,
            },
        )

    @application.get("/v1/projects/{project_id}/export.pdf", tags=["rendering"])
    async def export_pdf(
        request: Request,
        project_id: str,
        identity: IdentityDependency,
        revision: Annotated[int | None, Query(ge=1)] = None,
    ) -> Response:
        return await artifact_response(request, identity, project_id, revision, "handwritten_pdf")

    @application.get("/v1/projects/{project_id}/companion.pdf", tags=["rendering"])
    async def companion_pdf(
        request: Request,
        project_id: str,
        identity: IdentityDependency,
        revision: Annotated[int | None, Query(ge=1)] = None,
    ) -> Response:
        return await artifact_response(request, identity, project_id, revision, "companion_pdf")

    @application.get("/v1/projects/{project_id}/companion.txt", tags=["rendering"])
    async def companion_text(
        request: Request,
        project_id: str,
        identity: IdentityDependency,
        revision: Annotated[int | None, Query(ge=1)] = None,
    ) -> Response:
        return await artifact_response(request, identity, project_id, revision, "companion_text")

    @application.get(
        "/v1/projects/{project_id}/manifest.json",
        response_model=ArtifactManifest,
        tags=["rendering"],
    )
    async def artifact_manifest(
        request: Request,
        project_id: str,
        identity: IdentityDependency,
        kind: Annotated[ArtifactKind, Query()] = "handwritten_pdf",
        revision: Annotated[int | None, Query(ge=1)] = None,
    ) -> ArtifactManifest:
        project, record, _content = await run_in_threadpool(
            _artifact_bytes,
            _repository(request),
            _object_store(request),
            config,
            identity.owner_id,
            project_id,
            revision,
            kind,
        )
        return ArtifactManifest(
            project_id=project.id,
            project_revision=project.revision,
            source_sha256=project.sha256,
            artifact_kind=kind,
            artifact_sha256=record.sha256,
            artifact_bytes=record.size,
            generated_at=record.created_at,
        )

    return application


app = create_app()
