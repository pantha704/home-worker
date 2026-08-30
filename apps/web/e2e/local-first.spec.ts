import { expect, test } from "@playwright/test";
import path from "node:path";
import { PDFDocument, StandardFonts } from "pdf-lib";

const fixture = path.resolve(process.cwd(), "../../fixtures/sample-typed.pdf");

test("processes, reopens, edits, and exports a PDF without document API traffic", async ({ page }) => {
  const apiRequests: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.startsWith("/v1/")) apiRequests.push(request.url());
  });

  await page.goto("/");
  await page.getByLabel(/drop your notes/i).setInputFiles(fixture);
  await page.getByRole("button", { name: /turn into handwritten notes/i }).click();
  await expect(page).toHaveURL(/\/project\?id=local_/);
  const projectUrl = page.url();
  const editor = page.getByRole("textbox", { name: /review extracted text/i });
  await expect(editor).toContainText(/homeworker/i);
  await editor.fill("Reviewed local wording");
  await page.getByRole("button", { name: /save revision/i }).click();
  await expect(page.getByText(/revision 2/i)).toBeVisible();

  const pdfDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: /download A4 PDF/i }).click();
  expect((await pdfDownload).suggestedFilename()).toMatch(/reviewed\.pdf$/);

  const archiveDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: /export .homeworker backup/i }).click();
  expect((await archiveDownload).suggestedFilename()).toMatch(/\.homeworker$/);

  await page.goto(projectUrl);
  await expect(page.getByRole("textbox", { name: /review extracted text/i })).toHaveValue("Reviewed local wording");
  expect(apiRequests).toEqual([]);
});

test("extracts every source page in order", async ({ page }) => {
  const apiRequests: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.startsWith("/v1/")) apiRequests.push(request.url());
  });
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  for (const text of ["FIRST_PAGE_MARKER", "SECOND_PAGE_MARKER", "THIRD_PAGE_MARKER"]) {
    const sourcePage = pdf.addPage([400, 600]);
    sourcePage.drawText(text, { x: 40, y: 540, size: 16, font });
  }

  await page.goto("/");
  await page.getByLabel(/drop your notes/i).setInputFiles({
    name: "multi-page.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from(await pdf.save()),
  });
  await page.getByRole("button", { name: /turn into handwritten notes/i }).click();
  await expect(page).toHaveURL(/\/project\?id=local_/);
  await expect(page.getByRole("textbox", { name: /review extracted text/i })).toHaveValue(
    "FIRST_PAGE_MARKER\n\nSECOND_PAGE_MARKER\n\nTHIRD_PAGE_MARKER",
  );
  expect(apiRequests).toEqual([]);
});

test("keeps review and handwriting preview usable on a narrow phone", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto("/");
  await page.getByLabel(/drop your notes/i).setInputFiles(fixture);
  await page.getByRole("button", { name: /turn into handwritten notes/i }).click();
  await expect(page).toHaveURL(/\/project\?id=local_/);

  const editor = page.getByRole("textbox", { name: /review extracted text/i });
  const preview = page.getByLabel(/handwritten A4 preview/i);
  await expect(editor).toBeVisible();
  await expect(preview).toBeVisible();
  await expect(preview).toContainText(/homeworker/i);
  await page.evaluate(() => document.fonts.load('18px "Ink Scholar"'));
  expect(await page.evaluate(() => document.fonts.check('18px "Ink Scholar"'))).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

  const editorBox = await editor.boundingBox();
  const labelBox = await page.getByText("Review extracted text", { exact: true }).boundingBox();
  const titleBox = await page.locator(".project-title-group").boundingBox();
  const homeBox = await page.getByRole("link", { name: "Home" }).boundingBox();
  expect(editorBox?.width).toBeLessThanOrEqual(332);
  expect((labelBox?.y ?? 0) + (labelBox?.height ?? 0)).toBeLessThanOrEqual(editorBox?.y ?? 0);
  expect((titleBox?.x ?? 0) + (titleBox?.width ?? 0)).toBeLessThanOrEqual(homeBox?.x ?? 0);
  for (const box of [editorBox, labelBox, titleBox, homeBox, await preview.boundingBox()]) {
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(360);
  }
  expect(await preview.evaluate((element) => getComputedStyle(element.querySelector("p")!).fontFamily)).toContain("Ink Scholar");
  expect(await page.getByRole("link", { name: "Home" }).evaluate((element) => Number.parseFloat(getComputedStyle(element).fontSize))).toBeGreaterThan(0);
});
