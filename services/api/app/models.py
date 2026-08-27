"""Versioned public API models and canonical document IR."""

from __future__ import annotations

from datetime import datetime
from enum import StrEnum
from typing import Annotated, Literal

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    StringConstraints,
    field_validator,
    model_validator,
)


def to_camel(value: str) -> str:
    first, *rest = value.split("_")
    return first + "".join(part.capitalize() for part in rest)


class ApiModel(BaseModel):
    model_config = ConfigDict(
        alias_generator=to_camel,
        populate_by_name=True,
        serialize_by_alias=True,
        extra="forbid",
    )


class ProjectStatus(StrEnum):
    PROCESSING = "processing"
    NEEDS_REVIEW = "needs_review"
    READY = "ready"
    FAILED = "failed"


class BlockKind(StrEnum):
    HEADING = "heading"
    PARAGRAPH = "paragraph"
    LIST_ITEM = "list_item"
    EQUATION = "equation"
    TABLE = "table"
    FIGURE = "figure"
    UNKNOWN = "unknown"


class WarningSeverity(StrEnum):
    INFO = "info"
    WARNING = "warning"
    ERROR = "error"


class Extractor(StrEnum):
    NATIVE_PDF = "native_pdf"
    TESSERACT = "tesseract"
    MANUAL = "manual"


class PersonaId(StrEnum):
    SCHOLAR = "scholar"
    CASUAL = "casual"
    COMPACT = "compact"


class PaperStyle(StrEnum):
    PLAIN = "plain"
    RULED = "ruled"
    GRID = "grid"


class BoundingBox(ApiModel):
    x: float = Field(ge=0)
    y: float = Field(ge=0)
    width: float = Field(ge=0)
    height: float = Field(ge=0)


class ExtractionWarning(ApiModel):
    code: str = Field(min_length=1, max_length=80)
    message: str = Field(min_length=1, max_length=500)
    severity: WarningSeverity


class SourceRegion(ApiModel):
    page_number: int = Field(ge=1)
    bbox: BoundingBox | None
    extractor: Extractor


class DocumentBlock(ApiModel):
    id: str = Field(min_length=1)
    kind: BlockKind
    text: str
    confidence: float = Field(ge=0, le=1)
    reviewed: bool = False
    source: SourceRegion
    warnings: list[ExtractionWarning] = Field(default_factory=list)


class DocumentPage(ApiModel):
    number: int = Field(ge=1)
    width_points: float = Field(gt=0)
    height_points: float = Field(gt=0)
    blocks: list[DocumentBlock] = Field(default_factory=list)


HexColor = Annotated[str, StringConstraints(pattern=r"^#[0-9A-Fa-f]{6}$")]


class RenderSettings(ApiModel):
    persona_id: PersonaId = PersonaId.SCHOLAR
    seed: int = Field(default=42, ge=0, le=2_147_483_647)
    ink_color: HexColor = "#1D3557"
    paper_style: PaperStyle = PaperStyle.RULED
    margin_mm: float = Field(default=15, ge=8, le=30)
    line_spacing: float = Field(default=1.25, ge=0.8, le=2.5)
    font_size_pt: float = Field(default=0, ge=0, le=32)


class ProjectError(ApiModel):
    code: str
    message: str


class ProjectDocument(ApiModel):
    id: str
    filename: str = Field(min_length=1)
    mime_type: Literal["application/pdf", "image/png", "image/jpeg"]
    sha256: Annotated[str, StringConstraints(pattern=r"^[a-f0-9]{64}$")]
    status: ProjectStatus
    revision: int = Field(ge=1)
    created_at: datetime
    updated_at: datetime
    pages: list[DocumentPage]
    settings: RenderSettings = Field(default_factory=RenderSettings)
    error: ProjectError | None = None


class ProjectSummary(ApiModel):
    id: str
    filename: str
    mime_type: str
    status: ProjectStatus
    revision: int
    page_count: int = Field(ge=0)
    created_at: datetime
    updated_at: datetime


class ProjectList(ApiModel):
    items: list[ProjectSummary]
    total: int = Field(ge=0)


class BlockPatch(ApiModel):
    text: str = Field(max_length=200_000)
    expected_revision: int = Field(ge=1)

    @field_validator("text")
    @classmethod
    def reject_nul(cls, value: str) -> str:
        if "\x00" in value:
            raise ValueError("text must not contain NUL characters")
        return value


class PageTextPatch(ApiModel):
    text: str = Field(max_length=200_000)
    expected_revision: int = Field(ge=1)

    @field_validator("text")
    @classmethod
    def reject_nul(cls, value: str) -> str:
        if "\x00" in value:
            raise ValueError("text must not contain NUL characters")
        return value


class RetryPagesRequest(ApiModel):
    expected_revision: int = Field(ge=1)
    page_numbers: list[int] = Field(min_length=1, max_length=200)
    force_ocr: bool = False

    @field_validator("page_numbers")
    @classmethod
    def unique_positive_pages(cls, value: list[int]) -> list[int]:
        if any(number < 1 for number in value):
            raise ValueError("page numbers start at 1")
        if len(value) != len(set(value)):
            raise ValueError("page numbers must be unique")
        return value


class SettingsPatch(ApiModel):
    expected_revision: int = Field(ge=1)
    persona_id: PersonaId | None = None
    seed: int | None = Field(default=None, ge=0, le=2_147_483_647)
    ink_color: HexColor | None = None
    paper_style: PaperStyle | None = None
    margin_mm: float | None = Field(default=None, ge=8, le=30)
    line_spacing: float | None = Field(default=None, ge=0.8, le=2.5)
    font_size_pt: float | None = Field(default=None, ge=0, le=32)

    @model_validator(mode="after")
    def require_change(self) -> SettingsPatch:
        fields = self.model_dump(exclude={"expected_revision"}, exclude_none=True, by_alias=False)
        if not fields:
            raise ValueError("at least one render setting must be supplied")
        return self


class ConfirmRequest(ApiModel):
    expected_revision: int = Field(ge=1)
    acknowledged_block_ids: list[str] = Field(default_factory=list, max_length=10_000)

    @field_validator("acknowledged_block_ids")
    @classmethod
    def require_unique_block_ids(cls, value: list[str]) -> list[str]:
        if any(not block_id or len(block_id) > 100 for block_id in value):
            raise ValueError("acknowledged block IDs must be between 1 and 100 characters")
        if len(value) != len(set(value)):
            raise ValueError("acknowledged block IDs must be unique")
        return value


class ArtifactManifest(ApiModel):
    schema_version: Literal["1.0"] = "1.0"
    project_id: str
    project_revision: int = Field(ge=1)
    source_sha256: Annotated[str, StringConstraints(pattern=r"^[a-f0-9]{64}$")]
    artifact_kind: Literal["handwritten_pdf", "companion_pdf", "companion_text"]
    artifact_sha256: Annotated[str, StringConstraints(pattern=r"^[a-f0-9]{64}$")]
    artifact_bytes: int = Field(ge=0)
    generated_at: datetime


class Persona(ApiModel):
    id: PersonaId
    name: str
    description: str
    license: str


class HealthResponse(ApiModel):
    status: Literal["ok"] = "ok"
    service: str = "homeworker-api"


class ReadinessResponse(ApiModel):
    status: Literal["ready"] = "ready"
    database: Literal["ok"] = "ok"
    storage: Literal["ok"] = "ok"
