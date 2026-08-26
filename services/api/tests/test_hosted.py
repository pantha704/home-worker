from __future__ import annotations

import hashlib
import time
from dataclasses import replace
from datetime import UTC, datetime, timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import update

from app.auth import Identity
from app.config import Settings
from app.db import ProjectRow
from app.errors import InkError
from app.main import create_app
from app.models import ExtractionWarning, WarningSeverity
from app.storage import SupabaseObjectStore
from app.worker import cleanup_expired
from tests.conftest import make_native_pdf

SITE_ORIGIN = "https://homeworker.pages.dev"


class StaticTokenVerifier:
    def verify(self, token: str) -> Identity:
        identities = {
            "token-a": Identity(owner_id="11111111-1111-4111-8111-111111111111"),
            "token-b": Identity(owner_id="22222222-2222-4222-8222-222222222222"),
        }
        if token not in identities:
            raise AssertionError("unexpected token in hosted test")
        return identities[token]


def hosted_settings(tmp_path, **overrides: object) -> Settings:
    values: dict[str, object] = {
        "app_env": "test",
        "allow_test_backends": True,
        "runtime_mode": "hosted",
        "database_url": f"sqlite:///{tmp_path / 'hosted.db'}",
        "storage_provider": "local",
        "storage_root": tmp_path / "private-storage",
        "work_root": tmp_path / "work",
        "cors_origins": (SITE_ORIGIN,),
        "processing_mode": "inline",
        "start_worker": False,
    }
    values.update(overrides)
    return Settings(**values)  # type: ignore[arg-type]


def headers(token: str = "token-a", *, mutation: bool = False) -> dict[str, str]:
    result = {"Authorization": f"Bearer {token}"}
    if mutation:
        result.update({"Origin": SITE_ORIGIN, "X-Homeworker-Client": "web"})
    return result


def upload(client: TestClient, token: str = "token-a") -> dict:
    response = client.post(
        "/v1/projects",
        headers=headers(token, mutation=True),
        files={"file": ("lecture.pdf", make_native_pdf(), "application/pdf")},
    )
    assert response.status_code == 201, response.text
    return response.json()


def test_hosted_requires_auth_and_exact_mutation_origin(tmp_path) -> None:
    settings = hosted_settings(tmp_path)
    with TestClient(create_app(settings, token_verifier=StaticTokenVerifier())) as client:
        assert client.get("/v1/projects").status_code == 401

        untrusted = client.post(
            "/v1/projects",
            headers={"Authorization": "Bearer token-a"},
            files={"file": ("lecture.pdf", make_native_pdf(), "application/pdf")},
        )
        assert untrusted.status_code == 403
        assert untrusted.json()["error"]["code"] == "UNTRUSTED_REQUEST_ORIGIN"

        project = upload(client)
        fetched = client.get(f"/v1/projects/{project['id']}", headers=headers())
        assert fetched.status_code == 200
        assert fetched.headers["Cache-Control"] == "private, no-store"
        assert fetched.headers["Vary"] == "Origin, Authorization"


def test_cross_user_resources_are_indistinguishable_from_missing(tmp_path) -> None:
    settings = hosted_settings(tmp_path)
    with TestClient(create_app(settings, token_verifier=StaticTokenVerifier())) as client:
        project = upload(client, "token-a")
        project_id = project["id"]

        for path in (
            f"/v1/projects/{project_id}",
            f"/v1/projects/{project_id}/source.json",
            f"/v1/projects/{project_id}/export.pdf?revision=1",
        ):
            response = client.get(path, headers=headers("token-b"))
            assert response.status_code == 404
            assert response.json()["error"]["code"] == "PROJECT_NOT_FOUND"

        listing = client.get("/v1/projects", headers=headers("token-b"))
        assert listing.json() == {"items": [], "total": 0}
        deletion = client.delete(
            f"/v1/projects/{project_id}?expectedRevision=1",
            headers=headers("token-b", mutation=True),
        )
        assert deletion.status_code == 404
        assert client.get(f"/v1/projects/{project_id}", headers=headers()).status_code == 200


def test_review_acknowledgements_are_enforced_by_server(tmp_path) -> None:
    settings = hosted_settings(tmp_path)
    with TestClient(create_app(settings, token_verifier=StaticTokenVerifier())) as client:
        project = upload(client)
        project_id = project["id"]
        owner_id = "11111111-1111-4111-8111-111111111111"
        repository = client.app.state.repository

        def make_uncertain(current):
            updated = current.model_copy(deep=True)
            block = updated.pages[0].blocks[0]
            block.confidence = 0.5
            block.warnings.append(
                ExtractionWarning(
                    code="TEST_UNCERTAIN",
                    message="Compare this block with the source.",
                    severity=WarningSeverity.WARNING,
                )
            )
            updated.revision += 1
            updated.updated_at = updated.updated_at.replace(microsecond=1)
            return updated

        uncertain = repository.mutate(owner_id, project_id, 1, make_uncertain)
        block_id = uncertain.pages[0].blocks[0].id
        incomplete = client.post(
            f"/v1/projects/{project_id}/confirm",
            headers=headers(mutation=True),
            json={"expectedRevision": 2, "acknowledgedBlockIds": []},
        )
        assert incomplete.status_code == 409
        assert incomplete.json()["error"]["code"] == "REVIEW_INCOMPLETE"

        confirmed = client.post(
            f"/v1/projects/{project_id}/confirm",
            headers=headers(mutation=True),
            json={"expectedRevision": 2, "acknowledgedBlockIds": [block_id]},
        )
        assert confirmed.status_code == 200
        assert confirmed.json()["status"] == "ready"


def test_revision_exact_artifact_cache_and_manifest(tmp_path) -> None:
    settings = hosted_settings(tmp_path)
    with TestClient(create_app(settings, token_verifier=StaticTokenVerifier())) as client:
        project = upload(client)
        project_id = project["id"]
        first = client.get(
            f"/v1/projects/{project_id}/export.pdf?revision=1",
            headers=headers(),
        )
        second = client.get(
            f"/v1/projects/{project_id}/export.pdf?revision=1",
            headers=headers(),
        )
        assert first.status_code == 200
        assert first.content == second.content
        digest = hashlib.sha256(first.content).hexdigest()
        assert first.headers["X-Artifact-SHA256"] == digest

        manifest = client.get(
            f"/v1/projects/{project_id}/manifest.json?revision=1&kind=handwritten_pdf",
            headers=headers(),
        )
        assert manifest.status_code == 200
        assert manifest.json()["artifactSha256"] == digest
        assert manifest.json()["artifactBytes"] == len(first.content)
        assert manifest.json()["sourceSha256"] == project["sha256"]

        changed = client.patch(
            f"/v1/projects/{project_id}/settings",
            headers=headers(mutation=True),
            json={"expectedRevision": 1, "seed": 99},
        )
        assert changed.status_code == 200
        historical = client.get(
            f"/v1/projects/{project_id}/export.pdf?revision=1",
            headers=headers(),
        )
        current = client.get(
            f"/v1/projects/{project_id}/export.pdf?revision=2",
            headers=headers(),
        )
        assert historical.content == first.content
        assert current.content != first.content


def test_durable_worker_finishes_project_after_app_restart(tmp_path) -> None:
    base = hosted_settings(tmp_path, processing_mode="worker", start_worker=False)
    with TestClient(create_app(base, token_verifier=StaticTokenVerifier())) as first_client:
        project = upload(first_client)
        assert project["status"] == "processing"
        project_id = project["id"]

    restarted = replace(base, start_worker=True, job_poll_seconds=0.01)
    with TestClient(create_app(restarted, token_verifier=StaticTokenVerifier())) as second_client:
        body = None
        for _ in range(100):
            response = second_client.get(f"/v1/projects/{project_id}", headers=headers())
            body = response.json()
            if body["status"] != "processing":
                break
            time.sleep(0.02)
        assert body is not None
        assert body["status"] == "needs_review"
        assert body["revision"] == 2
        assert body["pages"][0]["blocks"]


def test_hosted_rate_and_project_quotas_stop_without_overage(tmp_path) -> None:
    rate_settings = hosted_settings(tmp_path, upload_rate_per_hour=1)
    with TestClient(create_app(rate_settings, token_verifier=StaticTokenVerifier())) as client:
        upload(client)
        limited = client.post(
            "/v1/projects",
            headers=headers(mutation=True),
            files={"file": ("second.pdf", make_native_pdf(), "application/pdf")},
        )
        assert limited.status_code == 429
        assert limited.json()["error"]["code"] == "RATE_LIMITED"

    quota_settings = hosted_settings(
        tmp_path / "quota",
        max_projects_per_user=1,
        upload_rate_per_hour=10,
    )
    with TestClient(create_app(quota_settings, token_verifier=StaticTokenVerifier())) as client:
        upload(client)
        limited = client.post(
            "/v1/projects",
            headers=headers(mutation=True),
            files={"file": ("second.pdf", make_native_pdf(), "application/pdf")},
        )
        assert limited.status_code == 409
        assert limited.json()["error"]["code"] == "PROJECT_QUOTA_EXCEEDED"


def test_environment_hosted_profile_fails_closed(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("INK_RUNTIME_MODE", "hosted")
    monkeypatch.setenv("INK_CORS_ORIGINS", SITE_ORIGIN)
    monkeypatch.setenv("INK_DATABASE_URL", "sqlite:///unsafe.db")
    monkeypatch.setenv("SUPABASE_URL", "https://example.supabase.co")
    monkeypatch.setenv("SUPABASE_PUBLISHABLE_KEY", "publishable")
    monkeypatch.setenv("SUPABASE_SECRET_KEY", "secret")
    with pytest.raises(ValueError, match="PostgreSQL"):
        Settings.from_env()

    monkeypatch.setenv("INK_DATABASE_URL", "postgresql+psycopg://postgres:pw@db:5432/postgres")
    monkeypatch.setenv("INK_START_WORKER", "false")
    with pytest.raises(ValueError, match="INK_START_WORKER"):
        Settings.from_env()


def test_supabase_secret_key_is_not_sent_as_a_bearer_jwt() -> None:
    store = SupabaseObjectStore(
        "https://example.supabase.co",
        "sb_secret_server_only",
        "homeworker-private",
    )
    try:
        assert store.client.headers["apikey"] == "sb_secret_server_only"
        assert "authorization" not in store.client.headers
    finally:
        store.close()


def test_expiry_hides_project_before_retryable_object_cleanup(tmp_path) -> None:
    settings = hosted_settings(tmp_path)
    with TestClient(create_app(settings, token_verifier=StaticTokenVerifier())) as client:
        project = upload(client)
        repository = client.app.state.repository
        object_store = client.app.state.object_store
        with repository.sessions.begin() as session:
            session.execute(
                update(ProjectRow)
                .where(ProjectRow.id == project["id"])
                .values(expires_at=datetime.now(UTC) - timedelta(seconds=1))
            )

        class UnavailableDeleteStore:
            def delete(self, keys: list[str]) -> None:
                del keys
                raise InkError(
                    "OBJECT_STORAGE_UNAVAILABLE",
                    "cleanup unavailable",
                    status_code=503,
                )

        with pytest.raises(InkError, match="cleanup unavailable"):
            cleanup_expired(repository, UnavailableDeleteStore())  # type: ignore[arg-type]

        assert client.get(f"/v1/projects/{project['id']}", headers=headers()).status_code == 404
        assert repository.pending_object_deletions()

        cleanup_expired(repository, object_store)
        assert repository.pending_object_deletions() == []
