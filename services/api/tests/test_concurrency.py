from __future__ import annotations

import threading
from concurrent.futures import ThreadPoolExecutor
from dataclasses import replace

from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app
from tests.conftest import make_native_pdf


def test_concurrent_uploads_cannot_bypass_project_quota(settings: Settings) -> None:
    limited = replace(settings, max_projects_per_user=1)
    with TestClient(create_app(limited)) as client:
        repository = client.app.state.repository
        original_usage = repository.usage
        barrier = threading.Barrier(2)
        calls = 0
        calls_lock = threading.Lock()

        def synchronized_usage(owner_id: str):
            nonlocal calls
            usage = original_usage(owner_id)
            with calls_lock:
                calls += 1
                should_wait = calls <= 2
            if should_wait:
                barrier.wait(timeout=5)
            return usage

        repository.usage = synchronized_usage

        def upload(name: str):
            return client.post(
                "/v1/projects",
                files={"file": (name, make_native_pdf(text=name), "application/pdf")},
            )

        with ThreadPoolExecutor(max_workers=2) as executor:
            responses = list(executor.map(upload, ("one.pdf", "two.pdf")))

        assert sorted(response.status_code for response in responses) == [201, 409]
        rejected = next(response for response in responses if response.status_code == 409)
        assert rejected.json()["error"]["code"] == "PROJECT_QUOTA_EXCEEDED"
        assert client.get("/v1/projects").json()["total"] == 1
        stored_sources = [path for path in limited.storage_root.rglob("*") if path.is_file()]
        assert len(stored_sources) == 1


def test_concurrent_idempotent_uploads_leave_one_project_and_one_source(settings: Settings) -> None:
    with TestClient(create_app(settings)) as client:
        repository = client.app.state.repository
        original_lookup = repository.get_by_idempotency_key
        barrier = threading.Barrier(2)
        calls = 0
        calls_lock = threading.Lock()

        def synchronized_lookup(owner_id: str, key: str):
            nonlocal calls
            result = original_lookup(owner_id, key)
            with calls_lock:
                calls += 1
                should_wait = calls <= 2
            if should_wait:
                barrier.wait(timeout=5)
            return result

        repository.get_by_idempotency_key = synchronized_lookup
        payload = make_native_pdf(text="same")

        def upload(_: int):
            return client.post(
                "/v1/projects",
                files={"file": ("same.pdf", payload, "application/pdf")},
                headers={"Idempotency-Key": "concurrent-same"},
            )

        with ThreadPoolExecutor(max_workers=2) as executor:
            responses = list(executor.map(upload, range(2)))

        assert sorted(response.status_code for response in responses) == [200, 201]
        assert len({response.json()["id"] for response in responses}) == 1
        assert client.get("/v1/projects").json()["total"] == 1
        stored_sources = [path for path in settings.storage_root.rglob("*") if path.is_file()]
        assert len(stored_sources) == 1
