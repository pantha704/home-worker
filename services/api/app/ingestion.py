"""Bounded upload streaming, type detection, and hostile-file validation."""

from __future__ import annotations

import hashlib
import os
import re
import shutil
import uuid
from dataclasses import dataclass
from pathlib import Path

import fitz
from fastapi import UploadFile
from PIL import Image, UnidentifiedImageError

from .config import Settings
from .errors import InkError

ALLOWED_MIME_TYPES = frozenset({"application/pdf", "image/png", "image/jpeg"})
EXTENSIONS = {"application/pdf": ".pdf", "image/png": ".png", "image/jpeg": ".jpg"}
CHUNK_SIZE = 1024 * 1024


@dataclass(frozen=True, slots=True)
class StoredUpload:
    project_id: str
    path: Path
    filename: str
    mime_type: str
    size: int
    sha256: str


def safe_display_filename(value: str | None) -> str:
    name = Path(value or "document").name
    name = "".join(character for character in name if character.isprintable())
    name = re.sub(r"[^A-Za-z0-9._() -]+", "_", name).strip(" .")
    return name[:180] or "document"


def sniff_mime(header: bytes) -> str | None:
    if header.startswith(b"%PDF-"):
        return "application/pdf"
    if header.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if header.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    return None


async def store_upload(upload: UploadFile, settings: Settings) -> StoredUpload:
    declared = (upload.content_type or "").lower().split(";", maxsplit=1)[0].strip()
    if declared not in ALLOWED_MIME_TYPES:
        raise InkError(
            "UNSUPPORTED_MEDIA_TYPE",
            "Upload a PDF, PNG, or JPEG file.",
            status_code=415,
            details={"received": declared or None, "allowed": sorted(ALLOWED_MIME_TYPES)},
        )

    incoming = settings.work_root / ".incoming"
    incoming.mkdir(parents=True, exist_ok=True)
    temporary = incoming / f"{uuid.uuid4()}.upload"
    digest = hashlib.sha256()
    size = 0
    header = b""
    try:
        with temporary.open("xb") as destination:
            while chunk := await upload.read(CHUNK_SIZE):
                size += len(chunk)
                if size > settings.max_upload_bytes:
                    raise InkError(
                        "UPLOAD_TOO_LARGE",
                        "The file exceeds the configured upload limit.",
                        status_code=413,
                        details={"maxBytes": settings.max_upload_bytes},
                    )
                if len(header) < 16:
                    header = (header + chunk)[:16]
                digest.update(chunk)
                destination.write(chunk)
            destination.flush()
            os.fsync(destination.fileno())

        if size == 0:
            raise InkError("EMPTY_UPLOAD", "The uploaded file is empty.", status_code=422)
        detected = sniff_mime(header)
        if detected is None:
            raise InkError(
                "UNRECOGNIZED_FILE_CONTENT",
                "The file content is not a valid PDF, PNG, or JPEG signature.",
                status_code=415,
            )
        if detected != declared:
            raise InkError(
                "MIME_MISMATCH",
                "The declared content type does not match the file bytes.",
                status_code=415,
                details={"declared": declared, "detected": detected},
            )

        validate_document(temporary, detected, settings)
        project_id = str(uuid.uuid4())
        project_dir = settings.work_root / "projects" / project_id
        project_dir.mkdir(parents=True, exist_ok=False)
        final_path = project_dir / f"source{EXTENSIONS[detected]}"
        os.replace(temporary, final_path)
        return StoredUpload(
            project_id=project_id,
            path=final_path,
            filename=safe_display_filename(upload.filename),
            mime_type=detected,
            size=size,
            sha256=digest.hexdigest(),
        )
    except Exception:
        temporary.unlink(missing_ok=True)
        raise
    finally:
        await upload.close()


def validate_document(path: Path, mime_type: str, settings: Settings) -> None:
    if mime_type == "application/pdf":
        try:
            with fitz.open(path) as document:
                if document.needs_pass:
                    raise InkError(
                        "ENCRYPTED_PDF",
                        "Password-protected PDFs are not supported. Export an unlocked copy first.",
                        status_code=422,
                    )
                if document.page_count < 1:
                    raise InkError("EMPTY_PDF", "The PDF contains no pages.", status_code=422)
                if document.page_count > settings.max_pdf_pages:
                    raise InkError(
                        "PDF_PAGE_LIMIT_EXCEEDED",
                        "The PDF has more pages than this installation accepts.",
                        status_code=413,
                        details={
                            "pageCount": document.page_count,
                            "maxPages": settings.max_pdf_pages,
                        },
                    )
                for page in document:
                    if page.rect.width <= 0 or page.rect.height <= 0:
                        raise InkError(
                            "INVALID_PAGE_GEOMETRY",
                            "A PDF page has invalid dimensions.",
                            status_code=422,
                            details={"pageNumber": page.number + 1},
                        )
        except InkError:
            raise
        except (fitz.FileDataError, RuntimeError, ValueError) as exc:
            raise InkError(
                "INVALID_PDF",
                "The PDF is damaged or could not be parsed safely.",
                status_code=422,
            ) from exc
        return

    try:
        with Image.open(path) as image:
            width, height = image.size
            if width <= 0 or height <= 0:
                raise InkError(
                    "INVALID_IMAGE", "The image has invalid dimensions.", status_code=422
                )
            pixels = width * height
            if pixels > settings.max_image_pixels:
                raise InkError(
                    "IMAGE_PIXEL_LIMIT_EXCEEDED",
                    "The image is too large to process safely.",
                    status_code=413,
                    details={"pixels": pixels, "maxPixels": settings.max_image_pixels},
                )
            image.verify()
    except InkError:
        raise
    except (Image.DecompressionBombError, UnidentifiedImageError, OSError) as exc:
        raise InkError(
            "INVALID_IMAGE",
            "The image is damaged or could not be decoded safely.",
            status_code=422,
        ) from exc


def remove_project_storage(settings: Settings, project_id: str) -> None:
    """Remove non-authoritative staged bytes after processing or upload failure."""
    shutil.rmtree(settings.work_root / "projects" / project_id, ignore_errors=True)


def delete_project_storage(settings: Settings, project_id: str) -> None:
    """Strict deletion for a staged working directory, kept for compatibility."""
    project_dir = settings.work_root / "projects" / project_id
    if project_dir.exists():
        shutil.rmtree(project_dir)
