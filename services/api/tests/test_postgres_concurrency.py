from __future__ import annotations

import os
import threading
from collections.abc import Iterator
from concurrent.futures import ThreadPoolExecutor
from dataclasses import replace
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text

from app.config import Settings
from app.main import create_app
from tests.conftest import make_native_pdf

POSTGRES_URL = os.environ.get("INK_TEST_DATABASE_URL", "").strip()


pytestmark = pytest.mark.skipif(
    not POSTGRES_URL,
    reason="INK_TEST_DATABASE_URL is not set",
)


@pytest.fixture
def pg_settings(tmp_path) -> Iterator[Settings]:
    schema = f"hwtest{uuid4().hex[:10]}"
    settings = Settings(
        app_env="test",
        allow_test_backends=True,
        database_url=POSTGRES_URL,
        database_schema=schema,
        storage_root=tmp_path / "storage",
        work_root=tmp_path / "work",
        cors_origins=("http://testserver",),
        processing_mode="worker",
        start_worker=False,
        max_projects_per_user=1,
    )
    yield settings
    engine = create_engine(POSTGRES_URL)
    with engine.begin() as connection:
        connection.execute(text(f'DROP SCHEMA IF EXISTS "{schema}" CASCADE'))
    engine.dispose()


def test_postgres_advisory_lock_blocks_quota_bypass(pg_settings: Settings) -> None:
    with TestClient(create_app(pg_settings)) as client:

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


def test_postgres_skip_locked_gives_one_worker_the_job(pg_settings: Settings) -> None:
    runtime = replace(pg_settings, max_projects_per_user=5)
    with TestClient(create_app(runtime)) as client:
        created = client.post(
            "/v1/projects",
            files={"file": ("lease.pdf", make_native_pdf(), "application/pdf")},
        )
        assert created.status_code == 201, created.text
        repository = client.app.state.repository
        barrier = threading.Barrier(2)

        def claim(worker_id: str):
            barrier.wait(timeout=5)
            return repository.claim_job(worker_id, lease_seconds=60)

        with ThreadPoolExecutor(max_workers=2) as executor:
            claimed = list(executor.map(claim, ("worker-a", "worker-b")))

        winners = [task for task in claimed if task is not None]
        assert len(winners) == 1
        assert winners[0].attempts == 1


def test_postgres_idempotent_create_survives_a_race(pg_settings: Settings) -> None:
    runtime = replace(pg_settings, max_projects_per_user=5)
    with TestClient(create_app(runtime)) as client:
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
