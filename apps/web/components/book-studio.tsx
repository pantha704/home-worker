"use client";

import { useEffect, useState } from "react";
import type { Persona, ProjectDocument, RenderSettings } from "@homeworker/contracts";

import { RenderSettingsPanel } from "@/components/render-settings-panel";
import { fetchPngObjectUrl } from "@/lib/api";

interface BookStudioProps {
  busy: boolean;
  deleting: boolean;
  personas: Persona[];
  project: ProjectDocument;
  onApply: (settings: RenderSettings) => Promise<void>;
  onDelete: () => void;
}

export function BookStudio({ busy, deleting, personas, project, onApply, onDelete }: BookStudioProps) {
  const [sheet, setSheet] = useState(1);
  const [maxSheet, setMaxSheet] = useState(1);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [flipping, setFlipping] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    let objectUrl: string | null = null;
    setImageUrl(null);
    fetchPngObjectUrl(
      `/v1/projects/${encodeURIComponent(project.id)}/sheets/${sheet}.png?revision=${project.revision}`,
      controller.signal,
    )
      .then((url) => {
        objectUrl = url;
        setImageUrl(url);
        setMaxSheet((current) => Math.max(current, sheet));
      })
      .catch(() => {
        if (sheet > 1) setSheet((current) => Math.max(1, current - 1));
      });
    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [project.id, project.revision, sheet]);

  function go(next: number) {
    setFlipping(true);
    setSheet(next);
    window.setTimeout(() => setFlipping(false), 280);
  }

  return (
    <div className="book-studio">
      <div className="book-stage">
        <button aria-label="Previous sheet" className="book-nav" disabled={sheet <= 1} onClick={() => go(sheet - 1)} type="button">
          ‹
        </button>
        <div className={`book-page ${flipping ? "is-flipping" : ""}`}>
          {imageUrl ? (
            <img alt={`Handwritten A4 sheet ${sheet}`} src={imageUrl} />
          ) : (
            <div className="book-loading" role="status">
              <span className="spinner spinner-large" />
              Writing this sheet…
            </div>
          )}
          <span className="book-folio">A4 · sheet {sheet}</span>
        </div>
        <button
          aria-label="Next sheet"
          className="book-nav"
          onClick={() => {
            setMaxSheet((current) => Math.max(current, sheet + 1));
            go(sheet + 1);
          }}
          type="button"
        >
          ›
        </button>
      </div>
      <aside className="book-settings">
        <RenderSettingsPanel
          busy={busy}
          deleting={deleting}
          key={`${project.settings.personaId}-${project.settings.seed}-${project.settings.inkColor}-${project.settings.paperStyle}-${project.settings.marginMm}-${project.settings.lineSpacing}-${project.settings.fontSizePt}`}
          onApply={onApply}
          onDelete={onDelete}
          personas={personas}
          settings={project.settings}
        />
      </aside>
    </div>
  );
}
