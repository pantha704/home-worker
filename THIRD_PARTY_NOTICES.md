# Third-party notices

Homeworker is AGPL-3.0-only. It depends on open-source packages declared in `package.json`, `pnpm-lock.yaml`, and `services/api/pyproject.toml`. Their license texts remain with those packages.

**PyMuPDF** is licensed under AGPL-3.0 (or a commercial license from Artifex). Linking and serving Homeworker therefore requires AGPL source offer. We do not use a commercial PyMuPDF grant in this repository.

The bundled Caveat, Patrick Hand, and Kalam fonts are SIL Open Font License 1.1. Copies live in `assets/fonts/OFL-*.txt`.

**Tesseract.js** and **tesseract.js-core** are Apache-2.0. Browser-local OCR vendors the English `eng.traineddata` language model from the naptha/tessdata 4.0.0 distribution (Apache-2.0) at build time. Those assets are not sent to a CDN at runtime.

