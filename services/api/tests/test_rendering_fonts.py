from __future__ import annotations

from pathlib import Path

import app.rendering as rendering


def test_font_asset_resolves_in_source_checkout() -> None:
    path = rendering._font_asset_path("Kalam-Regular.ttf")

    assert path.is_file(), path


def test_font_asset_survives_shallow_container_layout(monkeypatch) -> None:
    """The runtime image puts the package at /app/app, so Path.parents[3] is out of
    range. Resolving fonts there must fall back to the container candidate instead
    of raising IndexError, which made every hosted sheet render return 500."""
    monkeypatch.setattr(rendering, "__file__", "/app/app/rendering.py")

    path = rendering._font_asset_path("Kalam-Regular.ttf")

    assert Path(path) == Path("/app/assets/fonts/Kalam-Regular.ttf")
