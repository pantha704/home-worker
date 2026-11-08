"""Application use cases: faithful edits, review transition, and settings updates."""

from __future__ import annotations

import uuid
from collections.abc import Callable
from datetime import UTC, datetime

from .db import ProjectRepository
from .errors import InkError
from .models import (
    BlockKind,
    BlockPatch,
    BlockReviewRequest,
    ConfirmRequest,
    DocumentBlock,
    DocumentPage,
    ExtractionWarning,
    Extractor,
    PageTextPatch,
    ProjectDocument,
    ProjectError,
    ProjectStatus,
    SettingsPatch,
    SourceRegion,
    WarningSeverity,
)


def _next_revision(project: ProjectDocument) -> ProjectDocument:
    project.revision += 1
    project.updated_at = datetime.now(UTC)
    return project


def _mutate(
    repository: ProjectRepository,
    owner_id: str,
    project_id: str,
    expected_revision: int,
    apply: Callable[[ProjectDocument], ProjectDocument],
    *,
    job_lease: tuple[str, str] | None = None,
) -> ProjectDocument:
    """Edit a deep copy of the current revision and persist it as the next one."""

    def transform(current: ProjectDocument) -> ProjectDocument:
        return _next_revision(apply(current.model_copy(deep=True)))

    return repository.mutate(
        owner_id,
        project_id,
        expected_revision,
        transform,
        job_lease=job_lease,
    )


def _find_block(project: ProjectDocument, block_id: str) -> DocumentBlock:
    block = next(
        (item for page in project.pages for item in page.blocks if item.id == block_id),
        None,
    )
    if block is None:
        raise InkError(
            "BLOCK_NOT_FOUND",
            "No block with that ID exists in the project.",
            status_code=404,
        )
    return block


def patch_block(
    repository: ProjectRepository,
    owner_id: str,
    project_id: str,
    block_id: str,
    patch: BlockPatch,
) -> ProjectDocument:
    def apply(updated: ProjectDocument) -> ProjectDocument:
        target = _find_block(updated, block_id)
        target.text = patch.text
        target.confidence = 1.0
        target.reviewed = True
        target.source.extractor = Extractor.MANUAL
        target.warnings = [
            warning
            for warning in target.warnings
            if warning.code not in {"LOW_OCR_CONFIDENCE", "NO_TEXT_DETECTED"}
        ]
        target.warnings.append(
            ExtractionWarning(
                code="USER_CORRECTED",
                message="This block was explicitly corrected during review.",
                severity=WarningSeverity.INFO,
            )
        )
        updated.status = ProjectStatus.NEEDS_REVIEW
        return updated

    return _mutate(repository, owner_id, project_id, patch.expected_revision, apply)


def review_block(
    repository: ProjectRepository,
    owner_id: str,
    project_id: str,
    block_id: str,
    request: BlockReviewRequest,
) -> ProjectDocument:
    def apply(updated: ProjectDocument) -> ProjectDocument:
        target = _find_block(updated, block_id)
        if target.reviewed:
            raise InkError(
                "BLOCK_ALREADY_REVIEWED",
                "This extracted block has already been reviewed.",
                status_code=409,
            )
        target.reviewed = True
        target.warnings.append(
            ExtractionWarning(
                code="USER_APPROVED",
                message="This extracted block was explicitly approved during review.",
                severity=WarningSeverity.INFO,
            )
        )
        updated.status = ProjectStatus.NEEDS_REVIEW
        return updated

    return _mutate(repository, owner_id, project_id, request.expected_revision, apply)


def patch_page_text(
    repository: ProjectRepository,
    owner_id: str,
    project_id: str,
    page_number: int,
    patch: PageTextPatch,
) -> ProjectDocument:
    def apply(updated: ProjectDocument) -> ProjectDocument:
        target = next((page for page in updated.pages if page.number == page_number), None)
        if target is None:
            raise InkError(
                "PAGE_NOT_FOUND",
                "No extracted page with that number exists in the project.",
                status_code=404,
            )
        paragraphs = [part.strip() for part in patch.text.replace("\r\n", "\n").split("\n\n")]
        paragraphs = [part for part in paragraphs if part] or [""]
        target.blocks = [
            DocumentBlock(
                id=str(uuid.uuid4()),
                kind=BlockKind.PARAGRAPH if text else BlockKind.UNKNOWN,
                text=text,
                confidence=1.0,
                reviewed=True,
                source=SourceRegion(
                    page_number=page_number,
                    bbox=None,
                    extractor=Extractor.MANUAL,
                ),
                warnings=[
                    ExtractionWarning(
                        code="USER_CORRECTED",
                        message="This page was edited during side-by-side review.",
                        severity=WarningSeverity.INFO,
                    )
                ],
            )
            for text in paragraphs
        ]
        updated.status = ProjectStatus.NEEDS_REVIEW
        return updated

    return _mutate(repository, owner_id, project_id, patch.expected_revision, apply)


def replace_extracted_pages(
    repository: ProjectRepository,
    owner_id: str,
    project_id: str,
    expected_revision: int,
    replacements: list[DocumentPage],
) -> ProjectDocument:
    by_number = {page.number: page for page in replacements}

    def apply(updated: ProjectDocument) -> ProjectDocument:
        if updated.status == ProjectStatus.FAILED:
            raise InkError(
                "INVALID_STATE_TRANSITION",
                "A failed project cannot retry extraction.",
                status_code=409,
            )
        existing = {page.number for page in updated.pages}
        missing = sorted(number for number in by_number if number not in existing)
        if missing:
            raise InkError(
                "PAGE_NOT_FOUND",
                "Retry was requested for a page that is not in this revision.",
                status_code=404,
                details={"pageNumbers": missing},
            )
        updated.pages = [
            by_number[page.number].model_copy(deep=True) if page.number in by_number else page
            for page in updated.pages
        ]
        updated.status = ProjectStatus.NEEDS_REVIEW
        updated.error = None
        return updated

    return _mutate(repository, owner_id, project_id, expected_revision, apply)


def confirm_project(
    repository: ProjectRepository,
    owner_id: str,
    project_id: str,
    request: ConfirmRequest,
) -> ProjectDocument:
    def apply(updated: ProjectDocument) -> ProjectDocument:
        if updated.status == ProjectStatus.FAILED:
            raise InkError(
                "INVALID_STATE_TRANSITION",
                "A failed project cannot be confirmed.",
                status_code=409,
            )
        pending = [
            block.id
            for page in updated.pages
            for block in page.blocks
            if not block.reviewed and (block.confidence < 0.9 or bool(block.warnings))
        ]
        if pending:
            raise InkError(
                "REVIEW_INCOMPLETE",
                "Review every uncertain block before confirming this revision.",
                status_code=409,
                details={"pendingBlockIds": pending[:100], "pendingCount": len(pending)},
            )
        for page in updated.pages:
            for block in page.blocks:
                block.reviewed = True
        updated.status = ProjectStatus.READY
        return updated

    return _mutate(repository, owner_id, project_id, request.expected_revision, apply)


def patch_settings(
    repository: ProjectRepository,
    owner_id: str,
    project_id: str,
    patch: SettingsPatch,
) -> ProjectDocument:
    def apply(updated: ProjectDocument) -> ProjectDocument:
        values = patch.model_dump(exclude={"expected_revision"}, exclude_none=True, by_alias=False)
        updated.settings = updated.settings.model_copy(update=values)
        return updated

    return _mutate(repository, owner_id, project_id, patch.expected_revision, apply)


def complete_processing(
    repository: ProjectRepository,
    owner_id: str,
    project_id: str,
    expected_revision: int,
    pages: list[DocumentPage],
    *,
    job_lease: tuple[str, str] | None = None,
) -> ProjectDocument:
    def apply(updated: ProjectDocument) -> ProjectDocument:
        if updated.status != ProjectStatus.PROCESSING:
            raise InkError(
                "INVALID_STATE_TRANSITION",
                "Only a processing project can receive extracted pages.",
                status_code=409,
            )
        updated.pages = [page.model_copy(deep=True) for page in pages]
        updated.status = ProjectStatus.NEEDS_REVIEW
        updated.error = None
        return updated

    return _mutate(
        repository,
        owner_id,
        project_id,
        expected_revision,
        apply,
        job_lease=job_lease,
    )


def fail_processing(
    repository: ProjectRepository,
    owner_id: str,
    project_id: str,
    expected_revision: int,
    code: str,
    message: str,
) -> ProjectDocument:
    def apply(updated: ProjectDocument) -> ProjectDocument:
        updated.status = ProjectStatus.FAILED
        updated.error = ProjectError(code=code, message=message)
        return updated

    return _mutate(repository, owner_id, project_id, expected_revision, apply)
