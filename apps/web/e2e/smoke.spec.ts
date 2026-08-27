import { expect, test } from "@playwright/test";

const project = {
  id: "smoke-project",
  filename: "cell-notes.pdf",
  mimeType: "application/pdf",
  sha256: "a".repeat(64),
  status: "needs_review",
  revision: 1,
  createdAt: "2026-07-15T10:00:00.000Z",
  updatedAt: "2026-07-15T10:00:01.000Z",
  pages: [{
    number: 1,
    widthPoints: 595.28,
    heightPoints: 841.89,
    blocks: [{
      id: "b1",
      kind: "paragraph",
      text: "The cell membrane controls transport.",
      confidence: 0.82,
      reviewed: false,
      source: { pageNumber: 1, bbox: null, extractor: "native_pdf" },
      warnings: [{ code: "verify", message: "Please verify this wording.", severity: "warning" }],
    }],
  }],
  settings: {
    personaId: "scholar",
    seed: 42,
    inkColor: "#183B73",
    paperStyle: "ruled",
    marginMm: 15,
    lineSpacing: 1.2,
    fontSizePt: 0,
  },
  error: null,
};

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

test("uploads a source and opens the transparent review workspace", async ({ page }) => {
  await page.route("http://localhost:8000/v1/**", async (route) => {
    const url = route.request().url();
    if (url.endsWith("/v1/personas")) {
      await route.fulfill({ json: [] });
    } else if (url.includes(".png")) {
      await route.fulfill({ body: PNG, contentType: "image/png" });
    } else if (url.includes(".pdf")) {
      await route.fulfill({ body: "%PDF-1.7", contentType: "application/pdf" });
    } else {
      await route.fulfill({ json: project });
    }
  });

  await page.goto("/");
  await expect(page.getByRole("heading", { name: /notes that feel written/i })).toBeVisible();
  await expect(page.getByText(/no silent rewriting/i)).toBeVisible();

  await page.locator("#source-file").setInputFiles({ name: "cell-notes.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.7") });
  await page.getByRole("button", { name: /turn into handwritten notes/i }).click();

  await expect(page).toHaveURL(/\/project\?id=smoke-project$/);
  await expect(page.getByText(/Page 1 \/ 1/)).toBeVisible();
  await expect(page.getByLabel(/extracted text for page 1/i)).toHaveValue(/cell membrane/i);
  await expect(page.getByRole("button", { name: /^export$/i })).toBeDisabled();
});
