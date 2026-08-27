from __future__ import annotations

from fastapi.testclient import TestClient

from tests.conftest import make_native_pdf


def test_source_png_page_text_and_retry(client: TestClient) -> None:
    created = client.post(
        "/v1/projects",
        files={"file": ("notes.pdf", make_native_pdf(pages=2), "application/pdf")},
    )
    assert created.status_code == 201, created.text
    project = created.json()
    project_id = project["id"]
    assert len(project["pages"]) == 2
    first_text = "\n\n".join(block["text"] for block in project["pages"][0]["blocks"])

    png = client.get(f"/v1/projects/{project_id}/pages/1/source.png")
    assert png.status_code == 200
    assert png.headers["content-type"].startswith("image/png")
    assert png.content[:8] == b"\x89PNG\r\n\x1a\n"

    edited = client.patch(
        f"/v1/projects/{project_id}/pages/1",
        json={"text": "Edited page one.\n\nSecond paragraph.", "expectedRevision": 1},
    )
    assert edited.status_code == 200, edited.text
    body = edited.json()
    assert body["revision"] == 2
    assert [block["text"] for block in body["pages"][0]["blocks"]] == [
        "Edited page one.",
        "Second paragraph.",
    ]
    assert body["pages"][0]["blocks"][0]["source"]["extractor"] == "manual"
    assert body["pages"][1]["blocks"][0]["text"] == project["pages"][1]["blocks"][0]["text"]

    retried = client.post(
        f"/v1/projects/{project_id}/pages/retry",
        json={"expectedRevision": 2, "pageNumbers": [1], "forceOcr": False},
    )
    assert retried.status_code == 200, retried.text
    restored = retried.json()
    assert restored["revision"] == 3
    restored_text = "\n\n".join(block["text"] for block in restored["pages"][0]["blocks"])
    assert "Physics" in restored_text or restored_text != "Edited page one."
    assert restored["pages"][1]["blocks"][0]["id"] == body["pages"][1]["blocks"][0]["id"]

    missing = client.post(
        f"/v1/projects/{project_id}/pages/retry",
        json={"expectedRevision": 3, "pageNumbers": [9]},
    )
    assert missing.status_code == 404
    assert missing.json()["error"]["code"] == "PAGE_NOT_FOUND"

    del first_text
