from __future__ import annotations

from dataclasses import replace

import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.errors import InkError
from app.main import create_app
from app.service import complete_processing
from tests.conftest import make_native_pdf


def test_expired_worker_cannot_complete_reclaimed_job(settings: Settings) -> None:
    runtime = replace(settings, processing_mode="worker", start_worker=False)
    with TestClient(create_app(runtime)) as client:
        response = client.post(
            "/v1/projects",
            files={"file": ("lease.pdf", make_native_pdf(), "application/pdf")},
        )
        assert response.status_code == 201
        repository = client.app.state.repository

        stale = repository.claim_job("worker-a", lease_seconds=0)
        assert stale is not None
        current = repository.claim_job("worker-b", lease_seconds=60)
        assert current is not None
        assert current.id == stale.id

        assert repository.complete_job(stale.id, "worker-a") is False
        with pytest.raises(InkError, match="processing lease") as lost:
            complete_processing(
                repository,
                stale.owner_id,
                stale.project_id,
                1,
                [],
                job_lease=(stale.id, "worker-a"),
            )
        assert lost.value.code == "JOB_LEASE_LOST"

        completed = complete_processing(
            repository,
            current.owner_id,
            current.project_id,
            1,
            [],
            job_lease=(current.id, "worker-b"),
        )
        assert completed.revision == 2
        assert repository.complete_job(current.id, "worker-b") is False
