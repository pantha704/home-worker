"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { browserRepository, updateBrowserProject } from "@/lib/browser-local";
import type { LocalProject } from "@/lib/local-store";

function download(bytes: Uint8Array, filename: string, type: string) {
  const url = URL.createObjectURL(new Blob([bytes.slice()], { type }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function LocalReviewWorkspace({ projectId }: { projectId: string }) {
  const [project, setProject] = useState<LocalProject>();
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    let active = true;
    browserRepository().get(projectId)
      .then((value) => {
        if (!active) return;
        setProject(value);
        setDraft(value.text);
      })
      .catch((reason) => active && setError(reason instanceof Error ? reason.message : "Local project unavailable."));
    return () => { active = false; };
  }, [projectId]);

  async function save() {
    if (!project) return;
    setBusy(true);
    setError(undefined);
    try {
      setProject(await updateBrowserProject(project.id, project.revision, draft));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The revision could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  async function downloadPdf() {
    if (!project) return;
    download(await browserRepository().readExport(project.id), `${project.filename.replace(/\.pdf$/i, "")}-reviewed.pdf`, "application/pdf");
  }

  async function exportArchive() {
    if (!project) return;
    download(await browserRepository().exportArchive(project.id), `${project.filename.replace(/\.pdf$/i, "")}.homeworker`, "application/vnd.homeworker.project+json");
  }

  if (error && !project) return <main className="centered-state"><h1>Local project unavailable</h1><p>{error}</p><Link href="/">Return home</Link></main>;
  if (!project) return <main className="centered-state"><span className="spinner spinner-large" /><h1>Opening local project…</h1></main>;

  return (
    <main className="project-app">
      <header className="project-toolbar">
        <div className="toolbar-left">
          <div className="project-title-group">
            <strong>{project.filename}</strong>
            <span>Revision {project.revision} · private to this browser</span>
          </div>
        </div>
        <Link className="button button-ghost" href="/">Home</Link>
      </header>
      <section className="review-layout">
        <article className="review-panel">
          <span className="eyebrow">Text-layer extraction</span>
          <h2>Review before export</h2>
          <label htmlFor="local-review-text">Review extracted text</label>
          <textarea id="local-review-text" onChange={(event) => setDraft(event.target.value)} rows={18} value={draft} />
          {error ? <p className="mutation-error" role="alert">{error}</p> : null}
          <button className="button button-primary" disabled={busy || !draft.trim()} onClick={() => void save()} type="button">
            {busy ? "Generating…" : draft === project.text ? "Regenerate PDF" : "Save revision"}
          </button>
        </article>
        <aside className="preview-panel">
          <span className="eyebrow">A4 handwriting preview</span>
          <h2>First-page preview</h2>
          <div aria-label="Handwritten A4 preview" className="notebook-preview">
            <p>{draft || "Your reviewed text will appear here."}</p>
          </div>
          <p className="preview-help">This preview follows the handwriting, spacing, and ruled-paper style of the export. Save a revision to regenerate the downloadable PDF.</p>
          <button className="button button-primary button-wide" onClick={() => void downloadPdf()} type="button">Download A4 PDF</button>
          <button className="button button-secondary button-wide" onClick={() => void exportArchive()} type="button">Export .homeworker backup</button>
        </aside>
      </section>
    </main>
  );
}
