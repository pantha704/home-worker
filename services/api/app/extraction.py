"""Native-first PDF extraction and local Tesseract OCR normalization."""

from __future__ import annotations

import io
import re
import uuid
from collections import defaultdict
from pathlib import Path
from statistics import fmean

import fitz
from PIL import Image, ImageOps

from .config import Settings
from .errors import InkError
from .models import (
    BlockKind,
    BoundingBox,
    DocumentBlock,
    DocumentPage,
    ExtractionWarning,
    Extractor,
    SourceRegion,
    WarningSeverity,
)


def classify_block(text: str) -> BlockKind:
    stripped = text.strip()
    if not stripped:
        return BlockKind.UNKNOWN
    if re.match(r"^(?:[-*•]|\d+[.)])\s+", stripped):
        return BlockKind.LIST_ITEM
    if re.search(r"(?:=|≤|≥|∑|√|\^\d|\b(?:sin|cos|tan)\b)", stripped) and len(stripped) < 180:
        return BlockKind.EQUATION
    if (
        len(stripped) <= 90
        and len(stripped.splitlines()) == 1
        and (stripped.endswith(":") or stripped.isupper() or stripped.istitle())
    ):
        return BlockKind.HEADING
    return BlockKind.PARAGRAPH


def _warning(code: str, message: str, severity: WarningSeverity) -> ExtractionWarning:
    return ExtractionWarning(code=code, message=message, severity=severity)


def _native_pdf_blocks(page: fitz.Page, settings: Settings) -> list[DocumentBlock]:
    blocks: list[DocumentBlock] = []
    char_count = 0
    for raw in page.get_text("blocks", sort=True):
        x0, y0, x1, y1, raw_text, _block_number, block_type = raw[:7]
        if block_type != 0:
            continue
        text = str(raw_text).strip()
        if not text:
            continue
        char_count += len(text)
        if char_count > settings.max_extracted_chars_per_page:
            raise InkError(
                "EXTRACTED_TEXT_LIMIT_EXCEEDED",
                "A page expands to more text than this installation accepts.",
                status_code=413,
                details={
                    "pageNumber": page.number + 1,
                    "maxCharacters": settings.max_extracted_chars_per_page,
                },
            )
        blocks.append(
            DocumentBlock(
                id=str(uuid.uuid4()),
                kind=classify_block(text),
                text=text,
                confidence=0.99,
                reviewed=False,
                source=SourceRegion(
                    page_number=page.number + 1,
                    bbox=BoundingBox(
                        x=max(0.0, float(x0)),
                        y=max(0.0, float(y0)),
                        width=max(0.0, float(x1 - x0)),
                        height=max(0.0, float(y1 - y0)),
                    ),
                    extractor=Extractor.NATIVE_PDF,
                ),
                warnings=[],
            )
        )
    return blocks


def _ocr_blocks(
    image: Image.Image,
    *,
    page_number: int,
    points_per_pixel_x: float,
    points_per_pixel_y: float,
    settings: Settings,
) -> list[DocumentBlock]:
    try:
        import pytesseract
        from pytesseract import Output
    except ImportError as exc:
        raise InkError(
            "OCR_PYTHON_DEPENDENCY_UNAVAILABLE",
            "OCR requires the optional pytesseract package. Install the API OCR dependencies.",
            status_code=503,
            details={"action": "Run: pip install -e '.[dev]'"},
        ) from exc

    try:
        data = pytesseract.image_to_data(
            image,
            output_type=Output.DICT,
            timeout=settings.ocr_timeout_seconds,
            lang=settings.ocr_languages,
            config="--oem 3 --psm 6",
        )
    except pytesseract.TesseractNotFoundError as exc:
        raise InkError(
            "OCR_ENGINE_UNAVAILABLE",
            "Tesseract is required for scanned pages and images but was not found.",
            status_code=503,
            details={
                "action": (
                    "Install Tesseract (for example: apt install tesseract-ocr), then "
                    "restart the API."
                )
            },
        ) from exc
    except pytesseract.TesseractError as exc:
        raise InkError(
            "OCR_CONFIGURATION_ERROR",
            "Tesseract could not process the requested OCR languages.",
            status_code=503,
            details={
                "languages": settings.ocr_languages,
                "action": "Install the matching tesseract-ocr language packs and restart.",
            },
        ) from exc
    except RuntimeError as exc:
        message = str(exc).lower()
        code = "OCR_TIMEOUT" if "timeout" in message else "OCR_FAILED"
        raise InkError(
            code,
            "Local OCR did not complete. Try a clearer or smaller scan.",
            status_code=422,
            details={"pageNumber": page_number},
        ) from exc

    groups: dict[tuple[int, int, int], list[int]] = defaultdict(list)
    for index, text in enumerate(data.get("text", [])):
        if str(text).strip():
            key = (
                int(data["block_num"][index]),
                int(data["par_num"][index]),
                int(data["line_num"][index]),
            )
            groups[key].append(index)

    blocks: list[DocumentBlock] = []
    total_chars = 0
    for indexes in groups.values():
        words = [str(data["text"][index]).strip() for index in indexes]
        text = " ".join(word for word in words if word)
        if not text:
            continue
        total_chars += len(text)
        if total_chars > settings.max_extracted_chars_per_page:
            raise InkError(
                "EXTRACTED_TEXT_LIMIT_EXCEEDED",
                "OCR produced more text than this installation accepts for one page.",
                status_code=413,
                details={"pageNumber": page_number},
            )
        confidences = []
        for index in indexes:
            try:
                confidence = float(data["conf"][index])
            except (TypeError, ValueError):
                continue
            if confidence >= 0:
                confidences.append(confidence / 100)
        confidence = round(min(1.0, max(0.0, fmean(confidences) if confidences else 0.0)), 4)
        left = min(int(data["left"][index]) for index in indexes)
        top = min(int(data["top"][index]) for index in indexes)
        right = max(int(data["left"][index]) + int(data["width"][index]) for index in indexes)
        bottom = max(int(data["top"][index]) + int(data["height"][index]) for index in indexes)
        warnings = []
        if confidence < settings.low_confidence_threshold:
            warnings.append(
                _warning(
                    "LOW_OCR_CONFIDENCE",
                    "Tesseract was uncertain about this region; compare it with the source.",
                    WarningSeverity.WARNING,
                )
            )
        blocks.append(
            DocumentBlock(
                id=str(uuid.uuid4()),
                kind=classify_block(text),
                text=text,
                confidence=confidence,
                reviewed=False,
                source=SourceRegion(
                    page_number=page_number,
                    bbox=BoundingBox(
                        x=left * points_per_pixel_x,
                        y=top * points_per_pixel_y,
                        width=(right - left) * points_per_pixel_x,
                        height=(bottom - top) * points_per_pixel_y,
                    ),
                    extractor=Extractor.TESSERACT,
                ),
                warnings=warnings,
            )
        )

    if blocks:
        return blocks
    return [
        DocumentBlock(
            id=str(uuid.uuid4()),
            kind=BlockKind.UNKNOWN,
            text="",
            confidence=0,
            reviewed=False,
            source=SourceRegion(page_number=page_number, bbox=None, extractor=Extractor.TESSERACT),
            warnings=[
                _warning(
                    "NO_TEXT_DETECTED",
                    "No text was detected on this page; verify the source manually.",
                    WarningSeverity.WARNING,
                )
            ],
        )
    ]


def extract_document(
    path: Path,
    mime_type: str,
    settings: Settings,
    *,
    page_numbers: set[int] | None = None,
    force_ocr: bool = False,
) -> list[DocumentPage]:
    if mime_type == "application/pdf":
        return _extract_pdf(path, settings, page_numbers=page_numbers, force_ocr=force_ocr)
    if page_numbers and page_numbers - {1}:
        raise InkError(
            "PAGE_NOT_FOUND",
            "An image source only has page 1.",
            status_code=404,
            details={"pageNumbers": sorted(page_numbers)},
        )
    return _extract_image(path, settings)


def rasterize_source_page(
    path: Path,
    mime_type: str,
    page_number: int,
    *,
    max_width: int = 900,
) -> bytes:
    """PNG of one source page for the side-by-side reviewer."""
    if page_number < 1:
        raise InkError("PAGE_NOT_FOUND", "Page numbers start at 1.", status_code=404)
    buffer = io.BytesIO()
    if mime_type == "application/pdf":
        try:
            with fitz.open(path) as document:
                if page_number > document.page_count:
                    raise InkError(
                        "PAGE_NOT_FOUND",
                        "That page is not in the source document.",
                        status_code=404,
                        details={"pageNumber": page_number, "pageCount": document.page_count},
                    )
                page = document[page_number - 1]
                scale = min(2.2, max_width / max(page.rect.width, 1))
                pixmap = page.get_pixmap(matrix=fitz.Matrix(scale, scale), colorspace=fitz.csRGB, alpha=False)
                image = Image.frombytes("RGB", (pixmap.width, pixmap.height), pixmap.samples)
        except InkError:
            raise
        except (fitz.FileDataError, RuntimeError, ValueError) as exc:
            raise InkError("PDF_EXTRACTION_FAILED", "The source page could not be rendered.", status_code=422) from exc
    else:
        if page_number != 1:
            raise InkError("PAGE_NOT_FOUND", "An image source only has page 1.", status_code=404)
        try:
            with Image.open(path) as source:
                image = ImageOps.exif_transpose(source).convert("RGB")
        except OSError as exc:
            raise InkError("IMAGE_EXTRACTION_FAILED", "The image could not be decoded.", status_code=422) from exc
        if image.width > max_width:
            ratio = max_width / image.width
            image = image.resize((max_width, max(1, int(image.height * ratio))))
    image.save(buffer, format="PNG", optimize=True)
    return buffer.getvalue()


def enforce_total_text_limit(pages: list[DocumentPage], settings: Settings) -> None:
    total = 0
    for page in pages:
        total += sum(len(block.text) for block in page.blocks)
        if total > settings.max_total_extracted_chars:
            raise InkError(
                "DOCUMENT_TEXT_LIMIT_EXCEEDED",
                "The document expands to more text than this installation accepts.",
                status_code=413,
                details={"maxCharacters": settings.max_total_extracted_chars},
            )


def _extract_pdf(
    path: Path,
    settings: Settings,
    *,
    page_numbers: set[int] | None = None,
    force_ocr: bool = False,
) -> list[DocumentPage]:
    pages: list[DocumentPage] = []
    try:
        with fitz.open(path) as document:
            if page_numbers:
                missing = sorted(n for n in page_numbers if n < 1 or n > document.page_count)
                if missing:
                    raise InkError(
                        "PAGE_NOT_FOUND",
                        "One or more requested pages are not in the source document.",
                        status_code=404,
                        details={"pageNumbers": missing, "pageCount": document.page_count},
                    )
            for page in document:
                number = page.number + 1
                if page_numbers is not None and number not in page_numbers:
                    continue
                native = [] if force_ocr else _native_pdf_blocks(page, settings)
                if native:
                    blocks = native
                else:
                    scale = settings.ocr_dpi / 72
                    pixel_count = int(page.rect.width * scale) * int(page.rect.height * scale)
                    if pixel_count > settings.max_image_pixels:
                        raise InkError(
                            "OCR_RENDER_LIMIT_EXCEEDED",
                            "A scanned PDF page is too large to rasterize safely.",
                            status_code=413,
                            details={"pageNumber": page.number + 1},
                        )
                    pixmap = page.get_pixmap(
                        matrix=fitz.Matrix(scale, scale),
                        colorspace=fitz.csRGB,
                        alpha=False,
                    )
                    image = Image.frombytes("RGB", (pixmap.width, pixmap.height), pixmap.samples)
                    blocks = _ocr_blocks(
                        image,
                        page_number=page.number + 1,
                        points_per_pixel_x=page.rect.width / pixmap.width,
                        points_per_pixel_y=page.rect.height / pixmap.height,
                        settings=settings,
                    )
                pages.append(
                    DocumentPage(
                        number=page.number + 1,
                        width_points=float(page.rect.width),
                        height_points=float(page.rect.height),
                        blocks=blocks,
                    )
                )
    except InkError:
        raise
    except (fitz.FileDataError, RuntimeError, ValueError) as exc:
        raise InkError(
            "PDF_EXTRACTION_FAILED",
            "The PDF passed upload checks but could not be extracted.",
            status_code=422,
        ) from exc
    return pages


def _extract_image(path: Path, settings: Settings) -> list[DocumentPage]:
    try:
        with Image.open(path) as source:
            image = ImageOps.exif_transpose(source).convert("RGB")
    except OSError as exc:
        raise InkError(
            "IMAGE_EXTRACTION_FAILED", "The image could not be decoded.", status_code=422
        ) from exc
    width_points = image.width * 72 / 96
    height_points = image.height * 72 / 96
    blocks = _ocr_blocks(
        image,
        page_number=1,
        points_per_pixel_x=72 / 96,
        points_per_pixel_y=72 / 96,
        settings=settings,
    )
    return [
        DocumentPage(
            number=1,
            width_points=width_points,
            height_points=height_points,
            blocks=blocks,
        )
    ]
