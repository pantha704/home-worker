from __future__ import annotations

from fastapi.testclient import TestClient

from tests.conftest import make_native_pdf


def test_create_replays_the_same_idempotency_key(client: TestClient) -> None:
    payload = make_native_pdf()
    first = client.post(
        "/v1/projects",
        files={"file": ("notes.pdf", payload, "application/pdf")},
        headers={"Idempotency-Key": "upload-1"},
    )
    assert first.status_code == 201, first.text
    body = first.json()
    second = client.post(
        "/v1/projects",
        files={"file": ("notes.pdf", payload, "application/pdf")},
        headers={"Idempotency-Key": "upload-1"},
    )
    assert second.status_code == 200, second.text
    assert second.json()["id"] == body["id"]
    assert second.json()["sha256"] == body["sha256"]
    listing = client.get("/v1/projects")
    assert listing.json()["total"] == 1


def test_idempotency_key_cannot_cover_a_different_file(client: TestClient) -> None:
    first = client.post(
        "/v1/projects",
        files={"file": ("a.pdf", make_native_pdf(text="Alpha"), "application/pdf")},
        headers={"Idempotency-Key": "upload-2"},
    )
    assert first.status_code == 201, first.text
    reuse = client.post(
        "/v1/projects",
        files={"file": ("b.pdf", make_native_pdf(text="Beta notes here"), "application/pdf")},
        headers={"Idempotency-Key": "upload-2"},
    )
    assert reuse.status_code == 409
    assert reuse.json()["error"]["code"] == "IDEMPOTENCY_KEY_REUSE"
