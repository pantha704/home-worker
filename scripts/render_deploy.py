#!/usr/bin/env python3
"""Trigger, await, and verify a Render deploy — the same logic the Action runs.

Usage: render_deploy.py [--commit <sha>] [--dry-run]
"""

from __future__ import annotations

import json
import os
import re
import sys
import time
import urllib.error
import urllib.request
from typing import Any

SERVICE_ID = os.environ.get("RENDER_SERVICE_ID", "srv-dbo2br1srm7s73apm7v0")
BASE_URL = os.environ.get("HOMEWORKER_API_URL", "https://homeworker-api.onrender.com")
API = "https://api.render.com/v1"
TERMINAL = {"live", "build_failed", "update_failed", "canceled", "pre_deploy_failed"}


def render(method: str, path: str, body: dict[str, str] | None = None) -> tuple[int, Any]:
    key = os.environ["RENDER_API_KEY"]
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(
        API + path,
        data=data,
        method=method,
        headers={
            "Authorization": f"Bearer {key}",
            "Accept": "application/json",
            "Content-Type": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            raw = resp.read().decode()
            return resp.status, (json.loads(raw) if raw else None)
    except urllib.error.HTTPError as err:
        return err.code, err.read().decode()[:300]


def get_json(url: str, timeout: int = 60) -> tuple[int, Any]:
    try:
        with urllib.request.urlopen(url, timeout=timeout) as resp:
            return resp.status, json.loads(resp.read().decode() or "null")
    except urllib.error.HTTPError as err:
        return err.code, err.read().decode()[:200]


def expected_version() -> str:
    with open("services/api/pyproject.toml", encoding="utf-8") as handle:
        match = re.search(r'^version = "([^"]+)"', handle.read(), re.MULTILINE)
    if not match:
        raise SystemExit("could not read the version from services/api/pyproject.toml")
    return match.group(1)


def main() -> int:
    commit = None
    for index, arg in enumerate(sys.argv):
        if arg == "--commit":
            commit = sys.argv[index + 1]
    dry_run = "--dry-run" in sys.argv

    body: dict[str, str] = {"clearCache": "clear" if "--clear-cache" in sys.argv else "do_not_clear"}
    if commit:
        body["commitId"] = commit
    if dry_run:
        print(f"DRY RUN would POST /services/{SERVICE_ID}/deploys {body}")
        return 0

    status, deploy = render("POST", f"/services/{SERVICE_ID}/deploys", body)
    if status not in (200, 201, 202):
        print(f"deploy request failed: HTTP {status} {deploy}")
        return 1
    deploy = deploy or {}
    deploy_id = deploy.get("id")
    print(f"deploy {deploy_id} queued for commit {(deploy.get('commit') or {}).get('id', '')[:8]}")

    state = "queued"
    current: dict[str, Any] = {}
    deadline = time.time() + 15 * 60
    while time.time() < deadline:
        time.sleep(20)
        _, current = render("GET", f"/services/{SERVICE_ID}/deploys/{deploy_id}")
        current = current or {}
        state = current.get("status", state)
        print(f"  {state}")
        if state in TERMINAL:
            break
    if state != "live":
        print(f"deploy ended as {state} (deploy {deploy_id})")
        return 1
    print(f"deploy {deploy_id} is live on {(current.get('commit') or {}).get('id', '')[:8]}")

    # A live deploy is not proof the app works: readiness and the served version are.
    want = expected_version()
    saw_ready = False
    for attempt in range(12):
        code, ready = get_json(f"{BASE_URL}/ready")
        if code == 200 and isinstance(ready, dict):
            if ready.get("status") == "ready" and ready.get("database") == "ok" and ready.get("storage") == "ok":
                saw_ready = True
                break
        print(f"  readiness attempt {attempt + 1}: HTTP {code} {ready}")
        time.sleep(10)
    if not saw_ready:
        print("the deployment is live but /ready never reported database+storage ok")
        return 1
    print("readiness: database ok, storage ok")

    code, spec = get_json(f"{BASE_URL}/openapi.json")
    served = (spec or {}).get("info", {}).get("version") if isinstance(spec, dict) else None
    print(f"served version {served} (expected {want})")
    if served != want:
        print("served version does not match the commit being deployed")
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
