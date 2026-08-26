from __future__ import annotations

import io
import shutil

import fitz
import pytest
from fastapi.testclient import TestClient
from PIL import Image, ImageDraw, ImageFont


def ocr_png() -> bytes:
    image = Image.new("RGB", (1200, 320), "white")
    draw = ImageDraw.Draw(image)
    font = ImageFont.load_default(size=58)
    draw.text((60, 65), "BIOLOGY NOTES", font=font, fill="black")
    draw.text((60, 155), "Cells contain genetic material.", font=font, fill="black")
    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    return buffer.getvalue()


@pytest.mark.skipif(shutil.which("tesseract") is None, reason="Tesseract binary is not installed")
def test_png_upload_uses_real_local_tesseract(client: TestClient) -> None:
    content = ocr_png()

    response = client.post(
        "/v1/projects",
        files={"file": ("biology.png", content, "image/png")},
    )
    assert response.status_code == 201, response.text
    blocks = response.json()["pages"][0]["blocks"]
    assert all(block["source"]["extractor"] == "tesseract" for block in blocks)
    assert "BIOLOGY" in " ".join(block["text"] for block in blocks).upper()


@pytest.mark.skipif(shutil.which("tesseract") is None, reason="Tesseract binary is not installed")
def test_scanned_pdf_page_falls_back_to_real_local_tesseract(client: TestClient) -> None:
    document = fitz.open()
    page = document.new_page(width=600, height=300)
    page.insert_image(page.rect, stream=ocr_png())
    scanned_pdf = document.tobytes()
    document.close()

    response = client.post(
        "/v1/projects",
        files={"file": ("scan.pdf", scanned_pdf, "application/pdf")},
    )
    assert response.status_code == 201, response.text
    blocks = response.json()["pages"][0]["blocks"]
    assert all(block["source"]["extractor"] == "tesseract" for block in blocks)
    assert "BIOLOGY" in " ".join(block["text"] for block in blocks).upper()
