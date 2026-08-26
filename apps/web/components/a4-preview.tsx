"use client";

import { useEffect, useState } from "react";

import { DownloadIcon, RefreshIcon } from "@/components/icons";
import {
  fetchArtifact,
  getArtifactManifest,
  getExtractionEvidence,
  HomeworkerApiError,
  saveBlob,
  type ArtifactKind,
} from "@/lib/api";

interface A4PreviewProps {
  exportReady: boolean;
  filename: string;
  previewAvailable: boolean;
  projectId: string;
  revision: number;
}

export function A4Preview({ exportReady, filename, previewAvailable, projectId, revision }: A4PreviewProps) {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewKey, setPreviewKey] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [busy, setBusy] = useState<ArtifactKind | "manifest" | "source" | null>(null);

  useEffect(() => {
    if (!previewAvailable) return;
    const controller = new AbortController();
    let objectUrl: string | null = null;
    const requestedKey = `${projectId}:${revision}`;
    void fetchArtifact(projectId, revision, "handwritten_pdf", controller.signal)
      .then((download) => {
        objectUrl = URL.createObjectURL(download.blob);
        setPreviewUrl(objectUrl);
        setPreviewKey(requestedKey);
        setPreviewError(null);
      })
      .catch((error) => {
        if (controller.signal.aborted) return;
        setPreviewError(error instanceof HomeworkerApiError ? error.message : "The preview could not be loaded.");
      });
    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [previewAvailable, projectId, revision]);

  const activePreviewUrl = previewKey === `${projectId}:${revision}` ? previewUrl : null;

  async function download(kind: ArtifactKind) {
    setBusy(kind);
    setPreviewError(null);
    try {
      saveBlob(await fetchArtifact(projectId, revision, kind));
    } catch (error) {
      setPreviewError(error instanceof HomeworkerApiError ? error.message : "The download could not be prepared.");
    } finally {
      setBusy(null);
    }
  }

  async function downloadManifest() {
    setBusy("manifest");
    try {
      const manifest = await getArtifactManifest(projectId, revision);
      saveBlob({
        blob: new Blob([`${JSON.stringify(manifest, null, 2)}\n`], { type: "application/json" }),
        filename: `${filename.replace(/\.[^.]+$/, "") || "homeworker"}-manifest.json`,
        sha256: null,
      });
    } catch (error) {
      setPreviewError(error instanceof HomeworkerApiError ? error.message : "The manifest could not be prepared.");
    } finally {
      setBusy(null);
    }
  }

  async function downloadSourceEvidence() {
    setBusy("source");
    try {
      const evidence = await getExtractionEvidence(projectId);
      saveBlob({
        blob: new Blob([`${JSON.stringify(evidence, null, 2)}\n`], { type: "application/json" }),
        filename: `${filename.replace(/\.[^.]+$/, "") || "homeworker"}-extraction.json`,
        sha256: null,
      });
    } catch (error) {
      setPreviewError(error instanceof HomeworkerApiError ? error.message : "Source evidence could not be prepared.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <section aria-labelledby="preview-heading" className="preview-panel">
      <div className="preview-heading-row">
        <div><span className="eyebrow">Print preview</span><h2 id="preview-heading">A4 output</h2></div>
        <span className="a4-chip">210 × 297 mm</span>
      </div>

      <div className="preview-stage">
        {previewAvailable && activePreviewUrl ? (
          <object aria-label={`A4 preview of ${filename}`} className="pdf-preview" data={`${activePreviewUrl}#toolbar=0&navpanes=0&view=FitH`} key={`${projectId}-${revision}`} type="application/pdf">
            <div className="preview-fallback"><RefreshIcon size={28} /><p>Your browser cannot embed the PDF preview.</p></div>
          </object>
        ) : previewAvailable ? (
          <div className="a4-placeholder" role="status"><span className="spinner spinner-large" /><strong>Preparing the revision-exact preview…</strong></div>
        ) : (
          <div className="a4-placeholder" role="status">
            <span className="skeleton-line line-one" /><span className="skeleton-line line-two" /><span className="skeleton-line line-three" /><span className="skeleton-line line-four" />
            <strong>Preview appears after extraction</strong><small>We use the exact reviewed content and current seed.</small>
          </div>
        )}
      </div>

      {previewError ? <p className="auth-message error" role="alert">{previewError}</p> : null}
      <div className="download-stack">
        <button className="button button-primary button-wide" disabled={!exportReady || busy !== null} onClick={() => void download("handwritten_pdf")} type="button">
          {busy === "handwritten_pdf" ? <span className="spinner" /> : <DownloadIcon size={18} />} Download handwritten PDF
        </button>
        <button className="button button-secondary button-wide" disabled={!exportReady || busy !== null} onClick={() => void download("companion_pdf")} type="button">
          {busy === "companion_pdf" ? <span className="spinner" /> : <DownloadIcon size={18} />} Typed companion PDF
        </button>
      </div>
      <p className="preview-note">{exportReady ? "Downloads are authenticated and matched to this exact reviewed revision." : "Draft preview only. Complete the review to unlock downloads."}</p>
      <div className="evidence-links">
        <button className="accessible-text-link" disabled={!exportReady || busy !== null} onClick={() => void download("companion_text")} type="button"><DownloadIcon size={15} /> Accessible text</button>
        <button className="accessible-text-link" disabled={!exportReady || busy !== null} onClick={() => void downloadManifest()} type="button"><DownloadIcon size={15} /> Integrity manifest</button>
        <button className="accessible-text-link" disabled={!previewAvailable || busy !== null} onClick={() => void downloadSourceEvidence()} type="button"><DownloadIcon size={15} /> Extraction evidence</button>
      </div>
    </section>
  );
}
