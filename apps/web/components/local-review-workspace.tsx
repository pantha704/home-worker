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
    if (!project || draft === project.text) return;
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
        <div><span className="eyebrow">Browser-local project</span><h1>{project.filename}</h1><small>Revision {project.revision} · documents never leave this browser</small></div>
        <Link className="button button-ghost" href="/">Home</Link>
      </header>
      <section className="review-layout">
        <article className="review-panel">
          <span className="eyebrow">Text-layer extraction</span>
          <h2>Review before export</h2>
          <label htmlFor="local-review-text">Review extracted text</label>
          <textarea id="local-review-text" onChange={(event) => setDraft(event.target.value)} rows={18} value={draft} />
          {error ? <p className="mutation-error" role="alert">{error}</p> : null}
          <button className="button button-primary" disabled={busy || draft === project.text || !draft.trim()} onClick={() => void save()} type="button">
            {busy ? "Saving…" : "Save revision"}
          </button>
        </article>
        <aside className="preview-panel">
          <span className="eyebrow">Verified local output</span>
          <h2>A4 export</h2>
          <p>The dedicated worker generated this revision from the reviewed text. Scanned PDFs fail closed until browser OCR is enabled.</p>
          <button className="button button-primary button-wide" onClick={() => void downloadPdf()} type="button">Download A4 PDF</button>
          <button className="button button-secondary button-wide" onClick={() => void exportArchive()} type="button">Export .homeworker backup</button>
        </aside>
      </section>
    </main>
  );
}
