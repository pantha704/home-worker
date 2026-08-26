from __future__ import annotations

import io
from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient
from reportlab.pdfgen import canvas

from app.config import Settings
from app.main import create_app


def make_native_pdf(*, pages: int = 1, text: str = "Physics Notes") -> bytes:
    buffer = io.BytesIO()
    pdf = canvas.Canvas(buffer, invariant=1)
    for page in range(pages):
        pdf.drawString(72, 760, f"{text} {page + 1}")
        pdf.drawString(72, 735, "Force equals mass multiplied by acceleration.")
        pdf.drawString(72, 710, "F = m a")
        pdf.showPage()
    pdf.save()
    return buffer.getvalue()


@pytest.fixture
def settings(tmp_path) -> Settings:
    return Settings(
        app_env="test",
        database_url=f"sqlite:///{tmp_path / 'test.db'}",
        storage_root=tmp_path / "storage",
        cors_origins=("http://testserver",),
    )


@pytest.fixture
def client(settings: Settings) -> Iterator[TestClient]:
    with TestClient(create_app(settings)) as test_client:
        yield test_client


@pytest.fixture
def created_project(client: TestClient) -> dict:
    response = client.post(
        "/v1/projects",
        files={"file": ("lecture.pdf", make_native_pdf(), "application/pdf")},
    )
    assert response.status_code == 201, response.text
    return response.json()
