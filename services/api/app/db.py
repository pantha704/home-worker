"""Owner-scoped persistence, immutable revisions, durable jobs, quotas, and artifacts."""

from __future__ import annotations

import threading
import uuid
from collections.abc import Callable
from contextlib import nullcontext
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any, cast

from sqlalchemy import (
    JSON,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    UniqueConstraint,
    create_engine,
    delete,
    func,
    inspect,
    or_,
    select,
    text,
    update,
)
from sqlalchemy.engine import CursorResult, Engine
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, sessionmaker

from .errors import InkError
from .models import ProjectDocument, ProjectList, ProjectStatus, ProjectSummary

SCHEMA_TOKEN = "homeworker"


class Base(DeclarativeBase):
    pass


class ProjectRow(Base):
    __tablename__ = "projects"
    __table_args__ = (
        Index("ix_projects_owner_updated", "owner_id", "updated_at"),
        Index("ix_projects_owner_status", "owner_id", "status"),
        UniqueConstraint("owner_id", "idempotency_key", name="uq_projects_owner_idempotency"),
        {"schema": SCHEMA_TOKEN},
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    owner_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    filename: Mapped[str] = mapped_column(String(255), nullable=False)
    mime_type: Mapped[str] = mapped_column(String(64), nullable=False)
    sha256: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    source_key: Mapped[str] = mapped_column(String(512), nullable=False, unique=True)
    source_size: Mapped[int] = mapped_column(Integer, nullable=False)
    status: Mapped[str] = mapped_column(String(32), nullable=False, index=True)
    revision: Mapped[int] = mapped_column(Integer, nullable=False)
    page_count: Mapped[int] = mapped_column(Integer, nullable=False)
    document: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    idempotency_key: Mapped[str | None] = mapped_column(String(128), nullable=True)


class RevisionRow(Base):
    __tablename__ = "project_revisions"
    __table_args__ = (
        Index("ix_revisions_owner_project", "owner_id", "project_id"),
        {"schema": SCHEMA_TOKEN},
    )

    project_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey(f"{SCHEMA_TOKEN}.projects.id", ondelete="CASCADE"),
        primary_key=True,
    )
    revision: Mapped[int] = mapped_column(Integer, primary_key=True)
    owner_id: Mapped[str] = mapped_column(String(64), nullable=False)
    document: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class JobRow(Base):
    __tablename__ = "jobs"
    __table_args__ = (
        UniqueConstraint("project_id", name="uq_jobs_project"),
        Index("ix_jobs_claim", "status", "available_at", "lease_expires_at"),
        Index("ix_jobs_owner", "owner_id", "created_at"),
        {"schema": SCHEMA_TOKEN},
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    project_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey(f"{SCHEMA_TOKEN}.projects.id", ondelete="CASCADE"),
        nullable=False,
    )
    owner_id: Mapped[str] = mapped_column(String(64), nullable=False)
    status: Mapped[str] = mapped_column(String(24), nullable=False)
    attempts: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    available_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    lease_expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    leased_by: Mapped[str | None] = mapped_column(String(80))
    last_error: Mapped[str | None] = mapped_column(String(500))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class ArtifactRow(Base):
    __tablename__ = "artifacts"
    __table_args__ = (
        UniqueConstraint("object_key", name="uq_artifacts_object_key"),
        Index("ix_artifacts_owner_project", "owner_id", "project_id"),
        {"schema": SCHEMA_TOKEN},
    )

    project_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey(f"{SCHEMA_TOKEN}.projects.id", ondelete="CASCADE"),
        primary_key=True,
    )
    revision: Mapped[int] = mapped_column(Integer, primary_key=True)
    kind: Mapped[str] = mapped_column(String(32), primary_key=True)
    owner_id: Mapped[str] = mapped_column(String(64), nullable=False)
    object_key: Mapped[str] = mapped_column(String(512), nullable=False)
    sha256: Mapped[str] = mapped_column(String(64), nullable=False)
    size: Mapped[int] = mapped_column(Integer, nullable=False)
    media_type: Mapped[str] = mapped_column(String(96), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class RateLimitRow(Base):
    __tablename__ = "rate_limits"
    __table_args__ = ({"schema": SCHEMA_TOKEN},)

    owner_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    action: Mapped[str] = mapped_column(String(40), primary_key=True)
    window_start: Mapped[datetime] = mapped_column(DateTime(timezone=True), primary_key=True)
    count: Mapped[int] = mapped_column(Integer, nullable=False)
    expires_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, index=True
    )


class ObjectDeletionRow(Base):
    __tablename__ = "object_deletions"
    __table_args__ = (
        Index("ix_object_deletions_created", "created_at"),
        {"schema": SCHEMA_TOKEN},
    )

    object_key: Mapped[str] = mapped_column(String(512), primary_key=True)
    owner_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


@dataclass(frozen=True, slots=True)
class ProjectStorageUsage:
    project_count: int
    source_bytes: int
    artifact_bytes: int

    @property
    def total_bytes(self) -> int:
        return self.source_bytes + self.artifact_bytes


@dataclass(frozen=True, slots=True)
class ProjectSource:
    project: ProjectDocument
    source_key: str
    source_size: int
    mime_type: str


@dataclass(frozen=True, slots=True)
class JobTask:
    id: str
    project_id: str
    owner_id: str
    attempts: int


@dataclass(frozen=True, slots=True)
class ArtifactRecord:
    project_id: str
    revision: int
    kind: str
    owner_id: str
    object_key: str
    sha256: str
    size: int
    media_type: str
    created_at: datetime


@dataclass(frozen=True, slots=True)
class ExpiredProject:
    owner_id: str
    project_id: str
    source_key: str
    artifact_keys: tuple[str, ...]


def _sqlite_path(database_url: str) -> Path | None:
    prefix = "sqlite:///"
    if not database_url.startswith(prefix):
        return None
    raw = database_url.removeprefix(prefix)
    if raw == ":memory:":
        return None
    return Path(raw)


def _not_found() -> InkError:
    return InkError("PROJECT_NOT_FOUND", "No project exists with that ID.", status_code=404)


class ProjectRepository:
    def __init__(
        self,
        database_url: str,
        *,
        schema: str = "homeworker",
        auto_create: bool = True,
        max_revisions: int = 60,
        max_projects: int = 20,
        max_storage_bytes: int = 100 * 1024 * 1024,
    ) -> None:
        path = _sqlite_path(database_url)
        if path is not None:
            path.parent.mkdir(parents=True, exist_ok=True)
        self.is_sqlite = database_url.startswith("sqlite")
        connect_args: dict[str, Any] = (
            {"check_same_thread": False, "timeout": 30} if self.is_sqlite else {}
        )
        self.schema = schema
        self.auto_create = auto_create
        self.max_revisions = max_revisions
        self.max_projects = max_projects
        self.max_storage_bytes = max_storage_bytes
        self._sqlite_write_lock = threading.Lock()
        options = {"schema_translate_map": {SCHEMA_TOKEN: None if self.is_sqlite else schema}}
        engine_options: dict[str, Any] = {
            "connect_args": connect_args,
            "execution_options": options,
            "pool_pre_ping": True,
        }
        if not self.is_sqlite:
            engine_options.update({"pool_size": 4, "max_overflow": 0, "pool_recycle": 300})
        self.engine: Engine = create_engine(database_url, **engine_options)
        self.sessions = sessionmaker(self.engine, expire_on_commit=False)

    def initialize(self) -> None:
        if not self.is_sqlite and self.auto_create:
            with self.engine.begin() as connection:
                connection.execute(text(f'CREATE SCHEMA IF NOT EXISTS "{self.schema}"'))
        if self.auto_create:
            Base.metadata.create_all(self.engine)
        elif not inspect(self.engine).has_table("projects", schema=self.schema):
            raise RuntimeError("Homeworker database migration has not been applied")
        if self.is_sqlite:
            with self.engine.begin() as connection:
                connection.execute(text("PRAGMA journal_mode=WAL"))
                connection.execute(text("PRAGMA foreign_keys=ON"))

    def ping(self) -> None:
        with self.engine.connect() as connection:
            connection.execute(text("SELECT 1"))

    def usage(self, owner_id: str) -> ProjectStorageUsage:
        with self.sessions() as session:
            project_count = (
                session.scalar(
                    select(func.count())
                    .select_from(ProjectRow)
                    .where(ProjectRow.owner_id == owner_id)
                )
                or 0
            )
            source_bytes = (
                session.scalar(
                    select(func.coalesce(func.sum(ProjectRow.source_size), 0)).where(
                        ProjectRow.owner_id == owner_id
                    )
                )
                or 0
            )
            artifact_bytes = (
                session.scalar(
                    select(func.coalesce(func.sum(ArtifactRow.size), 0)).where(
                        ArtifactRow.owner_id == owner_id
                    )
                )
                or 0
            )
        return ProjectStorageUsage(
            project_count=int(project_count),
            source_bytes=int(source_bytes),
            artifact_bytes=int(artifact_bytes),
        )

    def create(
        self,
        owner_id: str,
        project: ProjectDocument,
        *,
        source_key: str,
        source_size: int,
        expires_at: datetime,
        enqueue: bool,
        idempotency_key: str | None = None,
    ) -> ProjectDocument:
        payload = project.model_dump(mode="json", by_alias=True)
        lock = self._sqlite_write_lock if self.is_sqlite else nullcontext()
        with lock, self.sessions.begin() as session:
            if not self.is_sqlite:
                session.execute(
                    text("SELECT pg_advisory_xact_lock(hashtextextended(:owner_id, 0))"),
                    {"owner_id": owner_id},
                )
            project_count = (
                session.scalar(
                    select(func.count())
                    .select_from(ProjectRow)
                    .where(ProjectRow.owner_id == owner_id)
                )
                or 0
            )
            if project_count >= self.max_projects:
                raise InkError(
                    "PROJECT_QUOTA_EXCEEDED",
                    "This account reached its project limit. Delete a project and retry.",
                    status_code=409,
                    details={"maxProjects": self.max_projects},
                )
            stored_bytes = (
                session.scalar(
                    select(func.coalesce(func.sum(ProjectRow.source_size), 0)).where(
                        ProjectRow.owner_id == owner_id
                    )
                )
                or 0
            )
            artifact_bytes = (
                session.scalar(
                    select(func.coalesce(func.sum(ArtifactRow.size), 0)).where(
                        ArtifactRow.owner_id == owner_id
                    )
                )
                or 0
            )
            if int(stored_bytes) + int(artifact_bytes) + source_size > self.max_storage_bytes:
                raise InkError(
                    "STORAGE_QUOTA_EXCEEDED",
                    "This account reached its private storage allowance. "
                    "Delete a project and retry.",
                    status_code=409,
                    details={"maxBytes": self.max_storage_bytes},
                )
            project_row = ProjectRow(
                id=project.id,
                owner_id=owner_id,
                filename=project.filename,
                mime_type=project.mime_type,
                sha256=project.sha256,
                source_key=source_key,
                source_size=source_size,
                status=project.status.value,
                revision=project.revision,
                page_count=len(project.pages),
                document=payload,
                expires_at=expires_at,
                created_at=project.created_at,
                updated_at=project.updated_at,
                idempotency_key=idempotency_key,
            )
            session.add(project_row)
            session.flush()
            session.add(
                RevisionRow(
                    project_id=project.id,
                    revision=project.revision,
                    owner_id=owner_id,
                    document=payload,
                    created_at=project.updated_at,
                )
            )
            if enqueue:
                session.add(
                    JobRow(
                        id=str(uuid.uuid4()),
                        project_id=project.id,
                        owner_id=owner_id,
                        status="queued",
                        attempts=0,
                        available_at=project.created_at,
                        lease_expires_at=None,
                        leased_by=None,
                        last_error=None,
                        created_at=project.created_at,
                        updated_at=project.created_at,
                    )
                )
        return project

    def get(self, owner_id: str, project_id: str) -> ProjectDocument:
        with self.sessions() as session:
            row = session.scalar(
                select(ProjectRow).where(
                    ProjectRow.id == project_id,
                    ProjectRow.owner_id == owner_id,
                )
            )
            if row is None:
                raise _not_found()
            return ProjectDocument.model_validate(row.document)

    def get_by_idempotency_key(self, owner_id: str, idempotency_key: str) -> ProjectDocument | None:
        with self.sessions() as session:
            row = session.scalar(
                select(ProjectRow).where(
                    ProjectRow.owner_id == owner_id,
                    ProjectRow.idempotency_key == idempotency_key,
                )
            )
            if row is None:
                return None
            return ProjectDocument.model_validate(row.document)

    def get_source(self, owner_id: str, project_id: str) -> ProjectSource:
        with self.sessions() as session:
            row = session.scalar(
                select(ProjectRow).where(
                    ProjectRow.id == project_id,
                    ProjectRow.owner_id == owner_id,
                )
            )
            if row is None:
                raise _not_found()
            return ProjectSource(
                project=ProjectDocument.model_validate(row.document),
                source_key=row.source_key,
                source_size=row.source_size,
                mime_type=row.mime_type,
            )

    def get_revision(self, owner_id: str, project_id: str, revision: int) -> ProjectDocument:
        with self.sessions() as session:
            row = session.scalar(
                select(RevisionRow).where(
                    RevisionRow.project_id == project_id,
                    RevisionRow.revision == revision,
                    RevisionRow.owner_id == owner_id,
                )
            )
            if row is None:
                raise _not_found()
            return ProjectDocument.model_validate(row.document)

    def get_extraction_evidence(self, owner_id: str, project_id: str) -> ProjectDocument:
        with self.sessions() as session:
            project_exists = session.scalar(
                select(ProjectRow.id).where(
                    ProjectRow.id == project_id,
                    ProjectRow.owner_id == owner_id,
                )
            )
            if project_exists is None:
                raise _not_found()
            rows = session.scalars(
                select(RevisionRow)
                .where(
                    RevisionRow.project_id == project_id,
                    RevisionRow.owner_id == owner_id,
                )
                .order_by(RevisionRow.revision)
            ).all()
            for row in rows:
                document = ProjectDocument.model_validate(row.document)
                if document.pages:
                    return document
        raise InkError(
            "EXTRACTION_NOT_READY",
            "Extraction evidence is not available until processing finishes.",
            status_code=409,
        )

    def list_projects(self, owner_id: str, *, limit: int, offset: int) -> ProjectList:
        with self.sessions() as session:
            total = (
                session.scalar(
                    select(func.count())
                    .select_from(ProjectRow)
                    .where(ProjectRow.owner_id == owner_id)
                )
                or 0
            )
            rows = session.scalars(
                select(ProjectRow)
                .where(ProjectRow.owner_id == owner_id)
                .order_by(ProjectRow.updated_at.desc(), ProjectRow.id)
                .limit(limit)
                .offset(offset)
            ).all()
            return ProjectList(
                items=[
                    ProjectSummary(
                        id=row.id,
                        filename=row.filename,
                        mime_type=row.mime_type,
                        status=ProjectStatus(row.status),
                        revision=row.revision,
                        page_count=row.page_count,
                        created_at=row.created_at,
                        updated_at=row.updated_at,
                    )
                    for row in rows
                ],
                total=int(total),
            )

    def mutate(
        self,
        owner_id: str,
        project_id: str,
        expected_revision: int,
        transform: Callable[[ProjectDocument], ProjectDocument],
        *,
        job_lease: tuple[str, str] | None = None,
    ) -> ProjectDocument:
        if expected_revision >= self.max_revisions:
            raise InkError(
                "REVISION_LIMIT_EXCEEDED",
                "This project reached its revision limit. Export it and start a new project.",
                status_code=409,
                details={"maxRevisions": self.max_revisions},
            )
        lock = self._sqlite_write_lock if self.is_sqlite else nullcontext()
        with lock, self.sessions.begin() as session:
            query = select(ProjectRow).where(
                ProjectRow.id == project_id,
                ProjectRow.owner_id == owner_id,
            )
            if not self.is_sqlite:
                query = query.with_for_update()
            row = session.scalar(query)
            if row is None:
                raise _not_found()
            if row.revision != expected_revision:
                raise InkError(
                    "REVISION_CONFLICT",
                    "The project changed since it was loaded. Refresh and retry.",
                    status_code=409,
                    details={
                        "expectedRevision": expected_revision,
                        "currentRevision": row.revision,
                    },
                )

            job_row: JobRow | None = None
            if job_lease is not None:
                job_id, worker_id = job_lease
                job_row = session.get(JobRow, job_id)
                if (
                    job_row is None
                    or job_row.project_id != project_id
                    or job_row.owner_id != owner_id
                    or job_row.status != "processing"
                    or job_row.leased_by != worker_id
                ):
                    raise InkError(
                        "JOB_LEASE_LOST",
                        "This processing lease is no longer current.",
                        status_code=409,
                    )

            current = ProjectDocument.model_validate(row.document)
            updated_project = transform(current)
            if updated_project.revision != expected_revision + 1:
                raise RuntimeError("repository mutation must increment revision exactly once")
            payload = updated_project.model_dump(mode="json", by_alias=True)
            result = cast(
                CursorResult[Any],
                session.execute(
                    update(ProjectRow)
                    .where(
                        ProjectRow.id == project_id,
                        ProjectRow.owner_id == owner_id,
                        ProjectRow.revision == expected_revision,
                    )
                    .values(
                        status=updated_project.status.value,
                        revision=updated_project.revision,
                        page_count=len(updated_project.pages),
                        document=payload,
                        updated_at=updated_project.updated_at,
                    )
                ),
            )
            if result.rowcount != 1:
                raise InkError(
                    "REVISION_CONFLICT",
                    "The project changed while the update was being saved.",
                    status_code=409,
                )
            session.add(
                RevisionRow(
                    project_id=project_id,
                    revision=updated_project.revision,
                    owner_id=owner_id,
                    document=payload,
                    created_at=updated_project.updated_at,
                )
            )
            if job_row is not None:
                job_row.status = "completed"
                job_row.lease_expires_at = None
                job_row.leased_by = None
                job_row.updated_at = updated_project.updated_at
            try:
                session.flush()
            except IntegrityError as exc:
                raise InkError(
                    "REVISION_CONFLICT",
                    "The project changed while the revision was being recorded.",
                    status_code=409,
                ) from exc
            return updated_project

    def delete(self, owner_id: str, project_id: str, expected_revision: int) -> list[str]:
        lock = self._sqlite_write_lock if self.is_sqlite else nullcontext()
        with lock, self.sessions.begin() as session:
            if not self.is_sqlite:
                session.execute(
                    text("SELECT pg_advisory_xact_lock(hashtextextended(:owner_id, 0))"),
                    {"owner_id": owner_id},
                )
            query = select(ProjectRow).where(
                ProjectRow.id == project_id,
                ProjectRow.owner_id == owner_id,
            )
            if not self.is_sqlite:
                query = query.with_for_update()
            row = session.scalar(query)
            if row is None:
                raise _not_found()
            if row.revision != expected_revision:
                raise InkError(
                    "REVISION_CONFLICT",
                    "The project changed since it was loaded. Refresh and retry.",
                    status_code=409,
                    details={
                        "expectedRevision": expected_revision,
                        "currentRevision": row.revision,
                    },
                )
            artifact_keys = session.scalars(
                select(ArtifactRow.object_key).where(
                    ArtifactRow.project_id == project_id,
                    ArtifactRow.owner_id == owner_id,
                )
            ).all()
            session.execute(
                delete(ArtifactRow).where(
                    ArtifactRow.project_id == project_id,
                    ArtifactRow.owner_id == owner_id,
                )
            )
            session.execute(
                delete(JobRow).where(
                    JobRow.project_id == project_id,
                    JobRow.owner_id == owner_id,
                )
            )
            session.execute(
                delete(RevisionRow).where(
                    RevisionRow.project_id == project_id,
                    RevisionRow.owner_id == owner_id,
                )
            )
            result = cast(
                CursorResult[Any],
                session.execute(
                    delete(ProjectRow).where(
                        ProjectRow.id == project_id,
                        ProjectRow.owner_id == owner_id,
                        ProjectRow.revision == expected_revision,
                    )
                ),
            )
            if result.rowcount != 1:
                raise InkError(
                    "REVISION_CONFLICT",
                    "The project changed while deletion was being saved.",
                    status_code=409,
                )
            object_keys = [row.source_key, *artifact_keys]
            now = datetime.now(UTC)
            for object_key in object_keys:
                session.merge(
                    ObjectDeletionRow(
                        object_key=object_key,
                        owner_id=owner_id,
                        created_at=now,
                    )
                )
            return object_keys

    def pending_object_deletions(self, limit: int = 100) -> list[str]:
        with self.sessions() as session:
            return list(
                session.scalars(
                    select(ObjectDeletionRow.object_key)
                    .order_by(ObjectDeletionRow.created_at, ObjectDeletionRow.object_key)
                    .limit(limit)
                ).all()
            )

    def complete_object_deletions(self, object_keys: list[str]) -> None:
        if not object_keys:
            return
        with self.sessions.begin() as session:
            session.execute(
                delete(ObjectDeletionRow).where(ObjectDeletionRow.object_key.in_(object_keys))
            )

    def consume_rate(self, owner_id: str, action: str, limit: int) -> None:
        now = datetime.now(UTC)
        window_start = now.replace(minute=0, second=0, microsecond=0)
        expires_at = window_start + timedelta(hours=2)
        lock = self._sqlite_write_lock if self.is_sqlite else nullcontext()
        with lock, self.sessions.begin() as session:
            if not self.is_sqlite:
                session.execute(
                    text("SELECT pg_advisory_xact_lock(hashtextextended(:owner_id, 0))"),
                    {"owner_id": owner_id},
                )
            query = select(RateLimitRow).where(
                RateLimitRow.owner_id == owner_id,
                RateLimitRow.action == action,
                RateLimitRow.window_start == window_start,
            )
            if not self.is_sqlite:
                query = query.with_for_update()
            row = session.scalar(query)
            if row is None:
                session.add(
                    RateLimitRow(
                        owner_id=owner_id,
                        action=action,
                        window_start=window_start,
                        count=1,
                        expires_at=expires_at,
                    )
                )
                return
            if row.count >= limit:
                retry_after = max(1, int((window_start + timedelta(hours=1) - now).total_seconds()))
                raise InkError(
                    "RATE_LIMITED",
                    "This account reached the current hourly limit. Try again later.",
                    status_code=429,
                    details={"retryAfterSeconds": retry_after, "action": action},
                )
            row.count += 1

    def claim_job(self, worker_id: str, lease_seconds: int) -> JobTask | None:
        now = datetime.now(UTC)
        with self.sessions.begin() as session:
            query = (
                select(JobRow)
                .where(
                    JobRow.available_at <= now,
                    or_(
                        JobRow.status == "queued",
                        (JobRow.status == "processing") & (JobRow.lease_expires_at < now),
                    ),
                )
                .order_by(JobRow.available_at, JobRow.created_at, JobRow.id)
                .limit(1)
            )
            if not self.is_sqlite:
                query = query.with_for_update(skip_locked=True)
            row = session.scalar(query)
            if row is None:
                return None
            row.status = "processing"
            row.attempts += 1
            row.leased_by = worker_id
            row.lease_expires_at = now + timedelta(seconds=lease_seconds)
            row.updated_at = now
            return JobTask(
                id=row.id,
                project_id=row.project_id,
                owner_id=row.owner_id,
                attempts=row.attempts,
            )

    def complete_job(self, job_id: str, worker_id: str) -> bool:
        with self.sessions.begin() as session:
            result = session.execute(
                update(JobRow)
                .where(
                    JobRow.id == job_id,
                    JobRow.status == "processing",
                    JobRow.leased_by == worker_id,
                )
                .values(
                    status="completed",
                    lease_expires_at=None,
                    leased_by=None,
                    updated_at=datetime.now(UTC),
                )
            )
            return cast(CursorResult[Any], result).rowcount == 1

    def retry_or_fail_job(
        self, job_id: str, worker_id: str, message: str, max_attempts: int
    ) -> bool:
        now = datetime.now(UTC)
        with self.sessions.begin() as session:
            row = session.get(JobRow, job_id)
            if row is None or row.status != "processing" or row.leased_by != worker_id:
                return True
            row.last_error = message[:500]
            row.lease_expires_at = None
            row.leased_by = None
            row.updated_at = now
            failed = row.attempts >= max_attempts
            if failed:
                row.status = "failed"
            else:
                row.status = "queued"
                row.available_at = now + timedelta(seconds=min(60, 2**row.attempts))
            return failed

    def get_artifact(
        self, owner_id: str, project_id: str, revision: int, kind: str
    ) -> ArtifactRecord | None:
        with self.sessions() as session:
            row = session.scalar(
                select(ArtifactRow).where(
                    ArtifactRow.owner_id == owner_id,
                    ArtifactRow.project_id == project_id,
                    ArtifactRow.revision == revision,
                    ArtifactRow.kind == kind,
                )
            )
            if row is None:
                return None
            return ArtifactRecord(
                project_id=row.project_id,
                revision=row.revision,
                kind=row.kind,
                owner_id=row.owner_id,
                object_key=row.object_key,
                sha256=row.sha256,
                size=row.size,
                media_type=row.media_type,
                created_at=row.created_at,
            )

    def record_artifact(self, artifact: ArtifactRecord) -> ArtifactRecord:
        lock = self._sqlite_write_lock if self.is_sqlite else nullcontext()
        with lock, self.sessions.begin() as session:
            if not self.is_sqlite:
                session.execute(
                    text("SELECT pg_advisory_xact_lock(hashtextextended(:owner_id, 0))"),
                    {"owner_id": artifact.owner_id},
                )
            project_exists = session.scalar(
                select(ProjectRow.id).where(
                    ProjectRow.id == artifact.project_id,
                    ProjectRow.owner_id == artifact.owner_id,
                )
            )
            if project_exists is None:
                raise _not_found()
            existing = session.get(
                ArtifactRow,
                {
                    "project_id": artifact.project_id,
                    "revision": artifact.revision,
                    "kind": artifact.kind,
                },
            )
            if existing is not None:
                if existing.owner_id != artifact.owner_id:
                    raise _not_found()
                return ArtifactRecord(
                    project_id=existing.project_id,
                    revision=existing.revision,
                    kind=existing.kind,
                    owner_id=existing.owner_id,
                    object_key=existing.object_key,
                    sha256=existing.sha256,
                    size=existing.size,
                    media_type=existing.media_type,
                    created_at=existing.created_at,
                )
            source_bytes = (
                session.scalar(
                    select(func.coalesce(func.sum(ProjectRow.source_size), 0)).where(
                        ProjectRow.owner_id == artifact.owner_id
                    )
                )
                or 0
            )
            artifact_bytes = (
                session.scalar(
                    select(func.coalesce(func.sum(ArtifactRow.size), 0)).where(
                        ArtifactRow.owner_id == artifact.owner_id
                    )
                )
                or 0
            )
            if int(source_bytes) + int(artifact_bytes) + artifact.size > self.max_storage_bytes:
                raise InkError(
                    "STORAGE_QUOTA_EXCEEDED",
                    "This account reached its private storage allowance. "
                    "Delete a project and retry.",
                    status_code=409,
                    details={"maxBytes": self.max_storage_bytes},
                )
            session.add(
                ArtifactRow(
                    project_id=artifact.project_id,
                    revision=artifact.revision,
                    kind=artifact.kind,
                    owner_id=artifact.owner_id,
                    object_key=artifact.object_key,
                    sha256=artifact.sha256,
                    size=artifact.size,
                    media_type=artifact.media_type,
                    created_at=artifact.created_at,
                )
            )
        return artifact

    def expired_projects(self, limit: int = 25) -> list[ExpiredProject]:
        now = datetime.now(UTC)
        with self.sessions() as session:
            projects = session.scalars(
                select(ProjectRow)
                .where(ProjectRow.expires_at <= now)
                .order_by(ProjectRow.expires_at, ProjectRow.id)
                .limit(limit)
            ).all()
            return [
                ExpiredProject(
                    owner_id=row.owner_id,
                    project_id=row.id,
                    source_key=row.source_key,
                    artifact_keys=tuple(
                        session.scalars(
                            select(ArtifactRow.object_key).where(
                                ArtifactRow.project_id == row.id,
                                ArtifactRow.owner_id == row.owner_id,
                            )
                        ).all()
                    ),
                )
                for row in projects
            ]

    def delete_expired(self, owner_id: str, project_id: str) -> list[str]:
        now = datetime.now(UTC)
        with self.sessions.begin() as session:
            query = select(ProjectRow).where(
                ProjectRow.id == project_id,
                ProjectRow.owner_id == owner_id,
                ProjectRow.expires_at <= now,
            )
            if not self.is_sqlite:
                query = query.with_for_update()
            row = session.scalar(query)
            if row is None:
                return []
            artifact_keys = list(
                session.scalars(
                    select(ArtifactRow.object_key).where(
                        ArtifactRow.project_id == project_id,
                        ArtifactRow.owner_id == owner_id,
                    )
                ).all()
            )
            object_keys = [row.source_key, *artifact_keys]
            for object_key in object_keys:
                session.merge(
                    ObjectDeletionRow(
                        object_key=object_key,
                        owner_id=owner_id,
                        created_at=now,
                    )
                )
            session.execute(
                delete(ArtifactRow).where(
                    ArtifactRow.project_id == project_id,
                    ArtifactRow.owner_id == owner_id,
                )
            )
            session.execute(
                delete(JobRow).where(JobRow.project_id == project_id, JobRow.owner_id == owner_id)
            )
            session.execute(
                delete(RevisionRow).where(
                    RevisionRow.project_id == project_id,
                    RevisionRow.owner_id == owner_id,
                )
            )
            session.execute(
                delete(ProjectRow)
                .where(
                    ProjectRow.id == project_id,
                    ProjectRow.owner_id == owner_id,
                )
                .execution_options(synchronize_session=False)
            )
            return object_keys

    def prune_rate_limits(self) -> None:
        with self.sessions.begin() as session:
            session.execute(delete(RateLimitRow).where(RateLimitRow.expires_at < datetime.now(UTC)))
