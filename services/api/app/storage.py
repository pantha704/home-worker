"""Private local and Supabase object-storage adapters."""

from __future__ import annotations

import hashlib
import os
import re
import tempfile
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import BinaryIO, Protocol
from urllib.parse import quote

import httpx

from .config import Settings
from .errors import InkError

OBJECT_KEY_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._/-]{0,500}$")


@dataclass(frozen=True, slots=True)
class StoredObject:
    key: str
    size: int
    sha256: str


class ObjectStore(Protocol):
    def put_file(self, key: str, path: Path, content_type: str) -> StoredObject: ...

    def put_bytes(self, key: str, content: bytes, content_type: str) -> StoredObject: ...

    def get_to_path(self, key: str, destination: Path) -> None: ...

    def get_bytes(self, key: str, max_bytes: int | None = None) -> bytes: ...

    def delete(self, keys: list[str]) -> None: ...

    def ping(self) -> None: ...

    def close(self) -> None: ...


def validate_object_key(key: str) -> str:
    if not OBJECT_KEY_PATTERN.fullmatch(key) or "//" in key:
        raise ValueError("invalid object key")
    parts = key.split("/")
    if any(part in {"", ".", ".."} for part in parts):
        raise ValueError("invalid object key segments")
    return key


def source_object_key(owner_id: str, project_id: str, extension: str) -> str:
    return validate_object_key(f"users/{owner_id}/projects/{project_id}/source{extension}")


def artifact_object_key(
    owner_id: str,
    project_id: str,
    revision: int,
    kind: str,
    digest: str,
    suffix: str,
) -> str:
    return validate_object_key(
        f"users/{owner_id}/projects/{project_id}/revisions/{revision}/{kind}-{digest}.{suffix}"
    )


def _copy_stream(source: BinaryIO, destination: BinaryIO) -> tuple[int, str]:
    digest = hashlib.sha256()
    size = 0
    while chunk := source.read(1024 * 1024):
        destination.write(chunk)
        digest.update(chunk)
        size += len(chunk)
    return size, digest.hexdigest()


class LocalObjectStore:
    def __init__(self, root: Path) -> None:
        self.root = root

    def _path(self, key: str) -> Path:
        validate_object_key(key)
        return self.root.joinpath(*key.split("/"))

    def put_file(self, key: str, path: Path, content_type: str) -> StoredObject:
        del content_type
        destination = self._path(key)
        destination.parent.mkdir(parents=True, exist_ok=True)
        temporary = destination.with_name(f".{destination.name}.{uuid.uuid4().hex}.tmp")
        try:
            with path.open("rb") as source, temporary.open("xb") as output:
                size, digest = _copy_stream(source, output)
                output.flush()
                os.fsync(output.fileno())
            os.replace(temporary, destination)
        finally:
            temporary.unlink(missing_ok=True)
        return StoredObject(key=key, size=size, sha256=digest)

    def put_bytes(self, key: str, content: bytes, content_type: str) -> StoredObject:
        del content_type
        destination = self._path(key)
        destination.parent.mkdir(parents=True, exist_ok=True)
        temporary = destination.with_name(f".{destination.name}.{uuid.uuid4().hex}.tmp")
        try:
            with temporary.open("xb") as output:
                output.write(content)
                output.flush()
                os.fsync(output.fileno())
            os.replace(temporary, destination)
        finally:
            temporary.unlink(missing_ok=True)
        return StoredObject(
            key=key,
            size=len(content),
            sha256=hashlib.sha256(content).hexdigest(),
        )

    def get_to_path(self, key: str, destination: Path) -> None:
        source = self._path(key)
        if not source.is_file():
            raise InkError(
                "OBJECT_NOT_FOUND", "Stored project data is unavailable.", status_code=404
            )
        destination.parent.mkdir(parents=True, exist_ok=True)
        with source.open("rb") as input_file, destination.open("wb") as output:
            _copy_stream(input_file, output)

    def get_bytes(self, key: str, max_bytes: int | None = None) -> bytes:
        path = self._path(key)
        if not path.is_file():
            raise InkError(
                "OBJECT_NOT_FOUND", "Stored project data is unavailable.", status_code=404
            )
        if max_bytes is not None and path.stat().st_size > max_bytes:
            raise InkError(
                "OBJECT_SIZE_LIMIT_EXCEEDED",
                "Stored project data exceeds the configured safety limit.",
                status_code=503,
            )
        return path.read_bytes()

    def delete(self, keys: list[str]) -> None:
        for key in keys:
            path = self._path(key)
            path.unlink(missing_ok=True)
            parent = path.parent
            while parent != self.root:
                try:
                    parent.rmdir()
                except OSError:
                    break
                parent = parent.parent

    def ping(self) -> None:
        self.root.mkdir(parents=True, exist_ok=True)
        with tempfile.NamedTemporaryFile(dir=self.root, prefix=".ready-", delete=True):
            pass

    def close(self) -> None:
        return


class SupabaseObjectStore:
    def __init__(self, base_url: str, secret_key: str, bucket: str) -> None:
        self.base_url = base_url.rstrip("/")
        self.bucket = bucket
        self.client = httpx.Client(
            timeout=httpx.Timeout(30.0, connect=5.0),
            headers={"apikey": secret_key},
            trust_env=False,
        )

    def _encoded(self, key: str) -> str:
        validate_object_key(key)
        return "/".join(quote(part, safe="") for part in key.split("/"))

    def _raise(self, response: httpx.Response) -> None:
        if response.is_success:
            return
        if response.status_code == 404:
            raise InkError(
                "OBJECT_NOT_FOUND", "Stored project data is unavailable.", status_code=404
            )
        raise InkError(
            "OBJECT_STORAGE_UNAVAILABLE",
            "Private file storage is temporarily unavailable.",
            status_code=503,
            details={"storageStatus": response.status_code},
        )

    def put_file(self, key: str, path: Path, content_type: str) -> StoredObject:
        digest = hashlib.sha256()
        with path.open("rb") as source:
            content = source.read()
        digest.update(content)
        return self._put(key, content, content_type, digest.hexdigest())

    def put_bytes(self, key: str, content: bytes, content_type: str) -> StoredObject:
        return self._put(key, content, content_type, hashlib.sha256(content).hexdigest())

    def _put(self, key: str, content: bytes, content_type: str, digest: str) -> StoredObject:
        try:
            response = self.client.post(
                f"{self.base_url}/storage/v1/object/{quote(self.bucket, safe='')}/"
                f"{self._encoded(key)}",
                content=content,
                headers={"Content-Type": content_type, "x-upsert": "false"},
            )
        except httpx.HTTPError as exc:
            raise InkError(
                "OBJECT_STORAGE_UNAVAILABLE",
                "Private file storage is temporarily unavailable.",
                status_code=503,
            ) from exc
        if response.status_code == 409:
            existing = self.get_bytes(key, len(content))
            if len(existing) == len(content) and hashlib.sha256(existing).hexdigest() == digest:
                return StoredObject(key=key, size=len(content), sha256=digest)
        self._raise(response)
        return StoredObject(key=key, size=len(content), sha256=digest)

    def get_to_path(self, key: str, destination: Path) -> None:
        try:
            with self.client.stream(
                "GET",
                f"{self.base_url}/storage/v1/object/authenticated/"
                f"{quote(self.bucket, safe='')}/{self._encoded(key)}",
            ) as response:
                self._raise(response)
                destination.parent.mkdir(parents=True, exist_ok=True)
                with destination.open("wb") as output:
                    for chunk in response.iter_bytes(1024 * 1024):
                        output.write(chunk)
        except httpx.HTTPError as exc:
            raise InkError(
                "OBJECT_STORAGE_UNAVAILABLE",
                "Private file storage is temporarily unavailable.",
                status_code=503,
            ) from exc

    def get_bytes(self, key: str, max_bytes: int | None = None) -> bytes:
        try:
            with self.client.stream(
                "GET",
                f"{self.base_url}/storage/v1/object/authenticated/"
                f"{quote(self.bucket, safe='')}/{self._encoded(key)}",
            ) as response:
                self._raise(response)
                body = bytearray()
                for chunk in response.iter_bytes(1024 * 1024):
                    body.extend(chunk)
                    if max_bytes is not None and len(body) > max_bytes:
                        raise InkError(
                            "OBJECT_SIZE_LIMIT_EXCEEDED",
                            "Stored project data exceeds the configured safety limit.",
                            status_code=503,
                        )
        except httpx.HTTPError as exc:
            raise InkError(
                "OBJECT_STORAGE_UNAVAILABLE",
                "Private file storage is temporarily unavailable.",
                status_code=503,
            ) from exc
        return bytes(body)

    def delete(self, keys: list[str]) -> None:
        if not keys:
            return
        encoded_keys = [validate_object_key(key) for key in keys]
        try:
            response = self.client.request(
                "DELETE",
                f"{self.base_url}/storage/v1/object/{quote(self.bucket, safe='')}",
                json={"prefixes": encoded_keys},
            )
        except httpx.HTTPError as exc:
            raise InkError(
                "OBJECT_STORAGE_UNAVAILABLE",
                "Private file storage cleanup must be retried.",
                status_code=503,
            ) from exc
        self._raise(response)

    def ping(self) -> None:
        try:
            response = self.client.get(
                f"{self.base_url}/storage/v1/bucket/{quote(self.bucket, safe='')}"
            )
        except httpx.HTTPError as exc:
            raise InkError(
                "OBJECT_STORAGE_UNAVAILABLE",
                "Private file storage is temporarily unavailable.",
                status_code=503,
            ) from exc
        self._raise(response)

    def close(self) -> None:
        self.client.close()


def build_object_store(settings: Settings) -> ObjectStore:
    if settings.storage_provider == "supabase":
        return SupabaseObjectStore(
            settings.supabase_url,
            settings.supabase_secret_key,
            settings.supabase_storage_bucket,
        )
    return LocalObjectStore(settings.storage_root)
