from pathlib import Path

import fitz
import pytest

from app.config import Settings
from app.errors import InkError
from app.ingestion import validate_document
from tests.conftest import make_native_pdf


def _settings(tmp_path: Path) -> Settings:
    return Settings(
        app_env="test",
        database_url=f"sqlite:///{tmp_path / 'ingest.db'}",
        storage_root=tmp_path / "storage",
        work_root=tmp_path / "work",
    )


def _write(tmp_path: Path, data: bytes) -> Path:
    path = tmp_path / "sample.pdf"
    path.write_bytes(data)
    return path


def test_visible_keyword_text_is_not_treated_as_active_content(tmp_path: Path) -> None:
    document = fitz.open()
    page = document.new_page()
    page.insert_text((72, 720), "Notes about JavaScript and /Launch /Encrypt /EmbeddedFile")
    path = _write(tmp_path, document.tobytes())
    document.close()
    validate_document(path, "application/pdf", _settings(tmp_path))


def test_embedded_file_pdfs_are_rejected(tmp_path: Path) -> None:
    document = fitz.open(stream=make_native_pdf(), filetype="pdf")
    document.embfile_add("note.txt", b"secret", filename="note.txt")
    path = _write(tmp_path, document.tobytes())
    document.close()
    with pytest.raises(InkError) as raised:
        validate_document(path, "application/pdf", _settings(tmp_path))
    assert raised.value.code == "ACTIVE_PDF"


def test_launch_action_pdfs_are_rejected(tmp_path: Path) -> None:
    document = fitz.open()
    page = document.new_page()
    page.insert_text((72, 720), "Launch target")
    page.insert_link(
        {
            "kind": fitz.LINK_LAUNCH,
            "from": fitz.Rect(50, 50, 120, 80),
            "file": "calc.exe",
        }
    )
    path = _write(tmp_path, document.tobytes())
    document.close()
    with pytest.raises(InkError) as raised:
        validate_document(path, "application/pdf", _settings(tmp_path))
    assert raised.value.code == "ACTIVE_PDF"
