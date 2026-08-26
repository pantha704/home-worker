from __future__ import annotations

import fitz
from fastapi.testclient import TestClient
from reportlab.lib.pagesizes import A4
from sqlalchemy import func, select

from app.config import Settings
from app.db import ObjectDeletionRow, RevisionRow
from app.errors import InkError
from app.main import create_app
from tests.conftest import make_native_pdf


def test_health_ready_and_request_id(client: TestClient) -> None:
    health = client.get("/health", headers={"X-Request-ID": "integration-42"})
    assert health.status_code == 200
    assert health.json() == {"status": "ok", "service": "homeworker-api"}
    assert health.headers["X-Request-ID"] == "integration-42"

    ready = client.get("/ready")
    assert ready.status_code == 200
    assert ready.json() == {"status": "ready", "database": "ok", "storage": "ok"}


def test_native_pdf_create_get_and_list(client: TestClient, created_project: dict) -> None:
    assert created_project["mimeType"] == "application/pdf"
    assert created_project["status"] == "needs_review"
    assert created_project["revision"] == 1
    assert len(created_project["sha256"]) == 64
    assert created_project["pages"][0]["widthPoints"] > 0
    first_block = created_project["pages"][0]["blocks"][0]
    assert first_block["confidence"] == 0.99
    assert first_block["reviewed"] is False
    assert first_block["source"]["extractor"] == "native_pdf"
    assert first_block["source"]["bbox"] is not None

    fetched = client.get(f"/v1/projects/{created_project['id']}")
    assert fetched.status_code == 200
    assert fetched.json() == created_project

    listing = client.get("/v1/projects?limit=10&offset=0")
    assert listing.status_code == 200
    assert listing.json()["total"] == 1
    assert listing.json()["items"][0]["pageCount"] == 1


def test_review_settings_confirm_and_revision_conflict(
    client: TestClient, created_project: dict
) -> None:
    project_id = created_project["id"]
    block_id = created_project["pages"][0]["blocks"][0]["id"]
    corrected = client.patch(
        f"/v1/projects/{project_id}/blocks/{block_id}",
        json={"text": "Physics — corrected heading", "expectedRevision": 1},
    )
    assert corrected.status_code == 200, corrected.text
    body = corrected.json()
    assert body["revision"] == 2
    edited = body["pages"][0]["blocks"][0]
    assert edited["reviewed"] is True
    assert edited["source"]["extractor"] == "manual"
    assert any(warning["code"] == "USER_CORRECTED" for warning in edited["warnings"])

    stale = client.patch(
        f"/v1/projects/{project_id}/blocks/{block_id}",
        json={"text": "stale", "expectedRevision": 1},
    )
    assert stale.status_code == 409
    assert stale.json()["error"]["code"] == "REVISION_CONFLICT"
    assert stale.json()["error"]["details"]["currentRevision"] == 2

    settings = client.patch(
        f"/v1/projects/{project_id}/settings",
        json={
            "expectedRevision": 2,
            "personaId": "casual",
            "paperStyle": "grid",
            "seed": 9001,
        },
    )
    assert settings.status_code == 200, settings.text
    assert settings.json()["settings"]["personaId"] == "casual"
    assert settings.json()["revision"] == 3

    confirmed = client.post(
        f"/v1/projects/{project_id}/confirm",
        json={"expectedRevision": 3},
    )
    assert confirmed.status_code == 200, confirmed.text
    assert confirmed.json()["status"] == "ready"
    assert confirmed.json()["revision"] == 4
    assert all(block["reviewed"] for page in confirmed.json()["pages"] for block in page["blocks"])
    final_export = client.get(f"/v1/projects/{project_id}/export.pdf")
    with fitz.open(stream=final_export.content, filetype="pdf") as document:
        assert "DRAFT - REVIEW REQUIRED" not in "\n".join(page.get_text() for page in document)


def test_personas_and_deterministic_a4_exports(client: TestClient, created_project: dict) -> None:
    personas = client.get("/v1/personas")
    assert personas.status_code == 200
    assert {item["id"] for item in personas.json()} == {"scholar", "casual", "compact"}
    assert all("Open Font License" in item["license"] for item in personas.json())

    project_id = created_project["id"]
    first = client.get(f"/v1/projects/{project_id}/export.pdf")
    second = client.get(f"/v1/projects/{project_id}/export.pdf")
    assert first.status_code == 200, first.text
    assert first.content == second.content
    assert first.headers["X-Project-Revision"] == "1"
    with fitz.open(stream=first.content, filetype="pdf") as document:
        assert document.page_count >= 1
        assert abs(document[0].rect.width - A4[0]) < 0.1
        assert abs(document[0].rect.height - A4[1]) < 0.1
        assert "DRAFT - REVIEW REQUIRED" in document[0].get_text()
        assert all(
            document.extract_font(font[0])[3]
            for page in document
            for font in page.get_fonts(full=True)
        )

    companion = client.get(f"/v1/projects/{project_id}/companion.pdf")
    assert companion.status_code == 200
    with fitz.open(stream=companion.content, filetype="pdf") as document:
        text = "\n".join(page.get_text() for page in document)
        assert "Physics Notes" in text
        assert all(
            document.extract_font(font[0])[3]
            for page in document
            for font in page.get_fonts(full=True)
        )

    plain_text = client.get(f"/v1/projects/{project_id}/companion.txt")
    assert plain_text.status_code == 200
    assert "Physics Notes" in plain_text.text
    assert created_project["sha256"] in plain_text.text


def test_strict_mime_and_magic_validation(client: TestClient) -> None:
    mismatch = client.post(
        "/v1/projects",
        files={"file": ("fake.png", make_native_pdf(), "image/png")},
    )
    assert mismatch.status_code == 415
    assert mismatch.json()["error"]["code"] == "MIME_MISMATCH"

    unsupported = client.post(
        "/v1/projects",
        files={"file": ("notes.txt", b"hello", "text/plain")},
    )
    assert unsupported.status_code == 415
    assert unsupported.json()["error"]["code"] == "UNSUPPORTED_MEDIA_TYPE"

    encrypted_document = fitz.open(stream=make_native_pdf(), filetype="pdf")
    encrypted = encrypted_document.tobytes(
        encryption=fitz.PDF_ENCRYPT_AES_256,
        owner_pw="owner-secret",
        user_pw="user-secret",
    )
    encrypted_document.close()
    password_protected = client.post(
        "/v1/projects",
        files={"file": ("locked.pdf", encrypted, "application/pdf")},
    )
    assert password_protected.status_code == 422
    assert password_protected.json()["error"]["code"] == "ENCRYPTED_PDF"


def test_upload_and_page_limits(tmp_path) -> None:
    settings = Settings(
        app_env="test",
        database_url=f"sqlite:///{tmp_path / 'limits.db'}",
        storage_root=tmp_path / "storage",
        max_upload_bytes=1_000_000,
        max_pdf_pages=1,
    )
    with TestClient(create_app(settings)) as client:
        too_many_pages = client.post(
            "/v1/projects",
            files={"file": ("two-pages.pdf", make_native_pdf(pages=2), "application/pdf")},
        )
        assert too_many_pages.status_code == 413
        assert too_many_pages.json()["error"]["code"] == "PDF_PAGE_LIMIT_EXCEEDED"

    tiny_settings = Settings(
        app_env="test",
        database_url=f"sqlite:///{tmp_path / 'tiny.db'}",
        storage_root=tmp_path / "tiny-storage",
        max_upload_bytes=16,
    )
    with TestClient(create_app(tiny_settings)) as client:
        too_large = client.post(
            "/v1/projects",
            files={"file": ("large.pdf", make_native_pdf(), "application/pdf")},
        )
        assert too_large.status_code == 413
        assert too_large.json()["error"]["code"] == "UPLOAD_TOO_LARGE"


def test_structured_validation_and_not_found_errors(client: TestClient) -> None:
    invalid = client.get("/v1/projects?limit=0")
    assert invalid.status_code == 422
    assert invalid.json()["error"]["code"] == "VALIDATION_ERROR"
    assert invalid.json()["error"]["requestId"]

    missing = client.get("/v1/projects/not-real")
    assert missing.status_code == 404
    assert missing.json()["error"]["code"] == "PROJECT_NOT_FOUND"


def test_openapi_uses_canonical_routes_and_camel_case(client: TestClient) -> None:
    schema = client.get("/openapi.json").json()
    paths = schema["paths"]
    assert "/v1/projects" in paths
    assert "/v1/projects/{project_id}/blocks/{block_id}" in paths
    assert "/v1/projects/{project_id}/confirm" in paths
    assert "/v1/projects/{project_id}/settings" in paths
    assert "/v1/projects/{project_id}/export.pdf" in paths
    assert "delete" in paths["/v1/projects/{project_id}"]
    project = schema["components"]["schemas"]["ProjectDocument"]
    assert "mimeType" in project["properties"]
    assert "createdAt" in project["properties"]
    settings_patch = schema["components"]["schemas"]["SettingsPatch"]
    assert "expectedRevision" in settings_patch["properties"]
    assert "personaId" in settings_patch["properties"]


def test_delete_honors_revision_and_removes_database_and_storage(
    client: TestClient, created_project: dict, settings: Settings
) -> None:
    project_id = created_project["id"]
    source_file = settings.storage_root / "users" / "local" / "projects" / project_id / "source.pdf"
    assert source_file.is_file()

    conflict = client.delete(f"/v1/projects/{project_id}?expectedRevision=99")
    assert conflict.status_code == 409
    assert conflict.json()["error"]["code"] == "REVISION_CONFLICT"
    assert source_file.is_file()

    deleted = client.delete(f"/v1/projects/{project_id}?expectedRevision=1")
    assert deleted.status_code == 204
    assert deleted.content == b""
    assert not source_file.exists()
    assert client.get(f"/v1/projects/{project_id}").status_code == 404

    repository = client.app.state.repository
    with repository.sessions() as session:
        revisions = session.scalar(
            select(func.count())
            .select_from(RevisionRow)
            .where(RevisionRow.project_id == project_id)
        )
    assert revisions == 0


def test_delete_surfaces_post_commit_storage_cleanup_failure(
    client: TestClient, created_project: dict, monkeypatch
) -> None:
    def fail_cleanup(*args, **kwargs) -> None:
        raise InkError(
            "OBJECT_STORAGE_UNAVAILABLE",
            "simulated storage failure",
            status_code=503,
        )

    monkeypatch.setattr(client.app.state.object_store, "delete", fail_cleanup)
    project_id = created_project["id"]
    response = client.delete(f"/v1/projects/{project_id}?expectedRevision=1")
    assert response.status_code == 204
    assert response.headers["X-Storage-Cleanup"] == "queued"
    assert client.get(f"/v1/projects/{project_id}").status_code == 404
    repository = client.app.state.repository
    with repository.sessions() as session:
        queued = session.scalar(select(func.count()).select_from(ObjectDeletionRow))
    assert queued == 1


def test_unsupported_pdf_glyphs_fail_visibly_but_utf8_companion_preserves_text(
    client: TestClient, created_project: dict
) -> None:
    project_id = created_project["id"]
    block_id = created_project["pages"][0]["blocks"][0]["id"]
    unicode_text = "मूल्य ₹100"
    patched = client.patch(
        f"/v1/projects/{project_id}/blocks/{block_id}",
        json={"text": unicode_text, "expectedRevision": 1},
    )
    assert patched.status_code == 200

    exported = client.get(f"/v1/projects/{project_id}/export.pdf")
    assert exported.status_code == 422
    assert exported.json()["error"]["code"] == "UNSUPPORTED_RENDER_GLYPHS"
    assert "U+20B9" in exported.json()["error"]["details"]["codePoints"]

    companion = client.get(f"/v1/projects/{project_id}/companion.txt")
    assert companion.status_code == 200
    assert unicode_text in companion.text
