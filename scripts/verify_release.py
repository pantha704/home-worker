from __future__ import annotations

import json
import re
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


@dataclass(frozen=True)
class Finding:
    code: str
    path: Path
    message: str


REQUIRED = [
    "CONTEXT.md",
    "PLAN.md",
    "SECURITY.md",
    "THIRD_PARTY_NOTICES.md",
    "VERSIONS.md",
    "packages/contracts/schema/project.schema.json",
    "skills/document-analyst/output.schema.json",
    "assets/fonts/Caveat-Regular.ttf",
    "assets/fonts/PatrickHand-Regular.ttf",
    "assets/fonts/Kalam-Regular.ttf",
    "assets/fonts/OFL-Caveat.txt",
    "assets/fonts/OFL-PatrickHand.txt",
    "assets/fonts/OFL-Kalam.txt",
    "fixtures/sample-typed.pdf",
    "fixtures/sample-handwritten.png",
    "render.yaml",
    "infra/.env.hosted.example",
    "apps/web/.env.hosted.example",
    "apps/web/wrangler.jsonc",
    "docs/free-public-deployment.md",
    "supabase/config.toml",
    "supabase/migrations/20260803073300_homeworker_v020.sql",
]

REQUIRED_EXECUTABLE = [
    "scripts/context-check.sh",
    "scripts/integration-smoke.sh",
    "scripts/package-release.sh",
    "scripts/start-local.sh",
    "infra/scripts/backup.sh",
    "infra/scripts/restore.sh",
]

FORBIDDEN_DIRS = {
    ".next",
    ".pytest_cache",
    ".ruff_cache",
    ".mypy_cache",
    ".venv",
    "__pycache__",
    "node_modules",
    "playwright-report",
    "test-results",
    "tmp",
    "coverage",
    "dist",
}

TEXT_SUFFIXES = {
    ".css",
    ".env",
    ".example",
    ".html",
    ".js",
    ".json",
    ".jsx",
    ".md",
    ".mjs",
    ".py",
    ".sh",
    ".toml",
    ".ts",
    ".tsx",
    ".txt",
    ".yaml",
    ".yml",
}

SECRET_PATTERNS = [
    re.compile(r"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----"),
    re.compile(r"\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b"),
    re.compile(r"OPENAI_API_KEY\s*=\s*[^\s#][^\s]*"),
]


def iter_release_entries(root: Path) -> list[Path]:
    """List releasable entries without scanning ignored development state."""
    if (root / ".git").exists():
        result = subprocess.run(
            ["git", "ls-files", "-z", "--cached", "--others", "--exclude-standard"],
            cwd=root,
            check=True,
            capture_output=True,
        )
        return sorted(
            (root / raw.decode("utf-8") for raw in result.stdout.split(b"\0") if raw),
            key=lambda path: path.as_posix(),
        )
    return sorted(root.rglob("*"), key=lambda path: path.as_posix())


def inspect(root: Path = ROOT) -> list[Finding]:
    findings: list[Finding] = []

    for item in REQUIRED:
        path = root / item
        if not path.is_file() or path.stat().st_size == 0:
            findings.append(Finding("required-file", path, "missing or empty"))

    for item in REQUIRED_EXECUTABLE:
        path = root / item
        if path.is_file() and path.stat().st_mode & 0o111 == 0:
            findings.append(Finding("executable", path, "shell entry point is not executable"))

    reported_generated: set[Path] = set()
    for path in iter_release_entries(root):
        rel = path.relative_to(root)
        forbidden_index = next(
            (index for index, part in enumerate(rel.parts) if part in FORBIDDEN_DIRS), None
        )
        if forbidden_index is not None:
            generated = Path(*rel.parts[: forbidden_index + 1])
            if generated not in reported_generated:
                findings.append(Finding("generated-directory", generated, "exclude from release"))
                reported_generated.add(generated)
            continue
        if not path.is_file():
            continue
        if path.name.startswith(".env") and not path.name.endswith(".example"):
            findings.append(Finding("secret-file", rel, "unexpected environment file"))
        if path.stat().st_size > 50 * 1024 * 1024:
            findings.append(Finding("large-file", rel, "file exceeds 50 MiB"))
        if path.suffix.lower() not in TEXT_SUFFIXES:
            continue
        try:
            content = path.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            findings.append(Finding("encoding", rel, "text file is not UTF-8"))
            continue
        for pattern in SECRET_PATTERNS:
            if pattern.search(content):
                findings.append(Finding("possible-secret", rel, pattern.pattern))

    for item in (
        "packages/contracts/schema/project.schema.json",
        "skills/document-analyst/output.schema.json",
    ):
        path = root / item
        if path.is_file():
            try:
                json.loads(path.read_text(encoding="utf-8"))
            except json.JSONDecodeError as exc:
                findings.append(Finding("invalid-json", path.relative_to(root), str(exc)))

    return findings


def main() -> int:
    findings = inspect()
    if findings:
        for finding in findings:
            print(f"{finding.code}: {finding.path}: {finding.message}")
        print(f"release audit failed with {len(findings)} finding(s)")
        return 1
    print("release audit passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
