"use client";

import { useEffect, useState } from "react";

import { fetchPngObjectUrl } from "@/lib/api";
import { pagePlainText } from "@/lib/project";
import type { DocumentPage } from "@homeworker/contracts";

interface PageReviewerProps {
  busyPage: number | null;
  draftText: string;
  index: number;
  page: DocumentPage;
  pageCount: number;
  projectId: string;
  refreshing: boolean;
  selected: boolean;
  onDraftChange: (text: string) => void;
  onIndexChange: (index: number) => void;
  onSave: () => void;
  onToggleSelect: () => void;
}

export function PageReviewer({
  busyPage,
  draftText,
  index,
  page,
  pageCount,
  projectId,
  refreshing,
  selected,
  onDraftChange,
  onIndexChange,
  onSave,
  onToggleSelect,
}: PageReviewerProps) {
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [imageError, setImageError] = useState<string | null>(null);
  const [touchX, setTouchX] = useState<number | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    let objectUrl: string | null = null;
    setImageUrl(null);
    setImageError(null);
    fetchPngObjectUrl(
      `/v1/projects/${encodeURIComponent(projectId)}/pages/${page.number}/source.png`,
      controller.signal,
    )
      .then((url) => {
        objectUrl = url;
        setImageUrl(url);
      })
      .catch(() => setImageError("Source preview unavailable."));
    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [page.number, projectId]);

  function onTouchStart(event: React.TouchEvent) {
    setTouchX(event.changedTouches[0]?.clientX ?? null);
  }

  function onTouchEnd(event: React.TouchEvent) {
    if (touchX == null) return;
    const delta = (event.changedTouches[0]?.clientX ?? touchX) - touchX;
    if (delta < -48 && index < pageCount - 1) onIndexChange(index + 1);
    if (delta > 48 && index > 0) onIndexChange(index - 1);
    setTouchX(null);
  }

  const original = pagePlainText(page);
  const dirty = draftText !== original;

  return (
    <section className="page-reviewer" onTouchEnd={onTouchEnd} onTouchStart={onTouchStart}>
      <div className="page-reviewer-nav">
        <button disabled={index === 0} onClick={() => onIndexChange(index - 1)} type="button">
          ← Prev
        </button>
        <strong>
          Page {page.number} / {pageCount}
        </strong>
        <button disabled={index >= pageCount - 1} onClick={() => onIndexChange(index + 1)} type="button">
          Next →
        </button>
      </div>
      <div className="page-reviewer-split">
        <div className="page-reviewer-source">
          {refreshing && busyPage === page.number ? (
            <div className="page-refreshing" role="status">
              <span className="spinner" /> Re-extracting this page…
            </div>
          ) : null}
          {imageUrl ? (
            <img alt={`Source page ${page.number}`} src={imageUrl} />
          ) : (
            <p>{imageError ?? "Loading source…"}</p>
          )}
        </div>
        <div className="page-reviewer-text">
          <label className="page-select">
            <input checked={selected} onChange={onToggleSelect} type="checkbox" />
            Retry this page
          </label>
          <textarea
            aria-label={`Extracted text for page ${page.number}`}
            onChange={(event) => onDraftChange(event.target.value)}
            value={draftText}
          />
          <div className="page-reviewer-actions">
            <button className="button button-secondary" disabled={!dirty} onClick={onSave} type="button">
              Save page
            </button>
            <span>{dirty ? "Unsaved edits" : "Matches extracted text"}</span>
          </div>
        </div>
      </div>
    </section>
  );
}
