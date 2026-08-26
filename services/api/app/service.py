"""Application use cases: faithful edits, review transition, and settings updates."""

from __future__ import annotations

from datetime import UTC, datetime

from .db import ProjectRepository
from .errors import InkError
from .models import (
    BlockPatch,
    ConfirmRequest,
    DocumentPage,
    ExtractionWarning,
    Extractor,
    ProjectDocument,
    ProjectStatus,
    SettingsPatch,
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
