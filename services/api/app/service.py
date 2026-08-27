"""Application use cases: faithful edits, review transition, and settings updates."""

from __future__ import annotations

from datetime import UTC, datetime
import uuid

from .db import ProjectRepository
from .errors import InkError
from .models import (
    BlockKind,
    BlockPatch,
    ConfirmRequest,
    DocumentBlock,
    DocumentPage,
    ExtractionWarning,
    Extractor,
    PageTextPatch,
    ProjectDocument,
    ProjectStatus,
    SettingsPatch,
    SourceRegion,
    WarningSeverity,
)


def _next_revision(project: ProjectDocument) -> ProjectDocument:
    project.revision += 1
    project.updated_at = datetime.now(UTC)
    return project


def patch_block(
    repository: ProjectRepository,
    owner_id: str,
    project_id: str,
    block_id: str,
    patch: BlockPatch,
) -> ProjectDocument:
    def transform(current: ProjectDocument) -> ProjectDocument:
        updated = current.model_copy(deep=True)
        target = None
        for page in updated.pages:
            for block in page.blocks:
                if block.id == block_id:
                    target = block
                    break
            if target:
                break
        if target is None:
            raise InkError(
                "BLOCK_NOT_FOUND",
                "No block with that ID exists in the project.",
                status_code=404,
            )
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
        return _next_revision(updated)

    return repository.mutate(owner_id, project_id, patch.expected_revision, transform)


def patch_page_text(
    repository: ProjectRepository,
    owner_id: str,
    project_id: str,
    page_number: int,
    patch: PageTextPatch,
) -> ProjectDocument:
    def transform(current: ProjectDocument) -> ProjectDocument:
        updated = current.model_copy(deep=True)
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
        return _next_revision(updated)

    return repository.mutate(owner_id, project_id, patch.expected_revision, transform)


def replace_extracted_pages(
    repository: ProjectRepository,
    owner_id: str,
    project_id: str,
    expected_revision: int,
    replacements: list[DocumentPage],
) -> ProjectDocument:
    by_number = {page.number: page for page in replacements}

    def transform(current: ProjectDocument) -> ProjectDocument:
        updated = current.model_copy(deep=True)
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
        return _next_revision(updated)

    return repository.mutate(owner_id, project_id, expected_revision, transform)


def confirm_project(
    repository: ProjectRepository,
    owner_id: str,
    project_id: str,
    request: ConfirmRequest,
) -> ProjectDocument:
    def transform(current: ProjectDocument) -> ProjectDocument:
        updated = current.model_copy(deep=True)
        if updated.status == ProjectStatus.FAILED:
            raise InkError(
                "INVALID_STATE_TRANSITION",
                "A failed project cannot be confirmed.",
                status_code=409,
            )
        acknowledged = set(request.acknowledged_block_ids)
        block_ids = {block.id for page in updated.pages for block in page.blocks}
        unknown = acknowledged - block_ids
        if unknown:
            raise InkError(
                "UNKNOWN_ACKNOWLEDGEMENT",
                "The review acknowledgement contains a block that is not in this revision.",
                status_code=409,
            )
        pending = [
            block.id
            for page in updated.pages
            for block in page.blocks
            if not block.reviewed
            and (block.confidence < 0.9 or bool(block.warnings))
            and block.id not in acknowledged
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
        return _next_revision(updated)

    return repository.mutate(owner_id, project_id, request.expected_revision, transform)


def patch_settings(
    repository: ProjectRepository,
    owner_id: str,
    project_id: str,
    patch: SettingsPatch,
) -> ProjectDocument:
    def transform(current: ProjectDocument) -> ProjectDocument:
        updated = current.model_copy(deep=True)
        values = patch.model_dump(exclude={"expected_revision"}, exclude_none=True, by_alias=False)
        updated.settings = updated.settings.model_copy(update=values)
        return _next_revision(updated)

    return repository.mutate(owner_id, project_id, patch.expected_revision, transform)


def complete_processing(
    repository: ProjectRepository,
    owner_id: str,
    project_id: str,
    expected_revision: int,
    pages: list[DocumentPage],
) -> ProjectDocument:
    def transform(current: ProjectDocument) -> ProjectDocument:
        if current.status != ProjectStatus.PROCESSING:
            raise InkError(
                "INVALID_STATE_TRANSITION",
                "Only a processing project can receive extracted pages.",
                status_code=409,
            )
        updated = current.model_copy(deep=True)
        updated.pages = [page.model_copy(deep=True) for page in pages]
        updated.status = ProjectStatus.NEEDS_REVIEW
        updated.error = None
        return _next_revision(updated)

    return repository.mutate(owner_id, project_id, expected_revision, transform)


def fail_processing(
    repository: ProjectRepository,
    owner_id: str,
    project_id: str,
    expected_revision: int,
    code: str,
    message: str,
) -> ProjectDocument:
    from .models import ProjectError

    def transform(current: ProjectDocument) -> ProjectDocument:
        updated = current.model_copy(deep=True)
        updated.status = ProjectStatus.FAILED
        updated.error = ProjectError(code=code, message=message)
        return _next_revision(updated)

    return repository.mutate(owner_id, project_id, expected_revision, transform)
