from __future__ import annotations

from pathlib import Path

import fitz
from PIL import Image

from app.config import Settings
from app.extraction import _ocr_blocks, classify_block
from app.models import BlockKind


def test_rule_classifier_never_changes_text() -> None:
    assert classify_block("1. First item") == BlockKind.LIST_ITEM
    assert classify_block("KINEMATICS") == BlockKind.HEADING
    assert classify_block("F = m a") == BlockKind.EQUATION
    assert classify_block("A complete explanatory sentence.") == BlockKind.PARAGRAPH


def test_ocr_normalizes_confidence_bbox_and_warning(monkeypatch) -> None:
    import pytesseract

    data = {
        "text": ["unclear", "notes"],
        "conf": ["55", "65"],
        "block_num": [1, 1],
        "par_num": [1, 1],
        "line_num": [1, 1],
        "left": [10, 80],
        "top": [20, 20],
        "width": [60, 50],
        "height": [20, 20],
    }
    monkeypatch.setattr(pytesseract, "image_to_data", lambda *args, **kwargs: data)
    blocks = _ocr_blocks(
        Image.new("RGB", (200, 100), "white"),
        page_number=2,
        points_per_pixel_x=0.5,
        points_per_pixel_y=0.5,
        settings=Settings(),
    )
    assert len(blocks) == 1
    block = blocks[0]
    assert block.text == "unclear notes"
    assert block.confidence == 0.6
    assert block.source.page_number == 2
    assert block.source.bbox is not None
    assert block.source.bbox.x == 5
    assert any(warning.code == "LOW_OCR_CONFIDENCE" for warning in block.warnings)


def test_typed_fixture_text_matches_browser_corpus_markers() -> None:
    fixture = Path(__file__).resolve().parents[3] / "fixtures" / "sample-typed.pdf"
    with fitz.open(fixture) as document:
        text = "\n".join(str(page.get_text()) for page in document)
    assert "Physics revision: Newton's laws" in text
    assert "Force equals mass times acceleration" in text
    assert "Rights-cleared synthetic fixture for Homeworker tests." in text
