from __future__ import annotations

import subprocess
import tempfile
import unittest
from pathlib import Path

from scripts.verify_release import iter_release_entries


class ReleaseEntriesTests(unittest.TestCase):
    def test_git_checkout_scans_only_tracked_release_files(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            subprocess.run(["git", "init", "-q"], cwd=root, check=True)
            (root / ".gitignore").write_text("node_modules/\nLOCAL-GOALS.md\n", encoding="utf-8")
            (root / "tracked.txt").write_text("release me", encoding="utf-8")
            ignored = root / "node_modules" / "dependency.txt"
            ignored.parent.mkdir()
            ignored.write_text("not part of the release", encoding="utf-8")
            (root / "LOCAL-GOALS.md").write_text("private plan", encoding="utf-8")
            subprocess.run(["git", "add", ".gitignore", "tracked.txt"], cwd=root, check=True)

            entries = {path.relative_to(root).as_posix() for path in iter_release_entries(root)}

            self.assertEqual(entries, {".gitignore", "tracked.txt"})

    def test_export_tree_without_git_metadata_scans_all_entries(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "tracked.txt").write_text("release me", encoding="utf-8")
            generated = root / "dist" / "artifact.txt"
            generated.parent.mkdir()
            generated.write_text("must be rejected", encoding="utf-8")

            entries = {path.relative_to(root).as_posix() for path in iter_release_entries(root)}

            self.assertEqual(entries, {"dist", "dist/artifact.txt", "tracked.txt"})


if __name__ == "__main__":
    unittest.main()
