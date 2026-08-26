"use client";

import { useId, useState } from "react";
import type { DocumentBlock } from "@homeworker/contracts";

import { CheckIcon, EditIcon, WarningIcon } from "@/components/icons";
import { ConfidenceBadge } from "@/components/confidence-badge";

interface BlockEditorProps {
  acknowledged: boolean;
  block: DocumentBlock;
  busy: boolean;
  isSelected: boolean;
  onAcknowledge: (blockId: string) => void;
  onSave: (blockId: string, text: string) => Promise<void>;
}

const KIND_LABELS: Record<DocumentBlock["kind"], string> = {
  heading: "Heading",
  paragraph: "Paragraph",
  list_item: "List item",
  equation: "Equation",
  table: "Table",
  figure: "Figure",
  unknown: "Unclassified",
};

export function BlockEditor({ acknowledged, block, busy, isSelected, onAcknowledge, onSave }: BlockEditorProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(block.text);
  const editorId = useId();

  const changed = draft !== block.text;

  async function save() {
    try {
      await onSave(block.id, draft);
      setEditing(false);
    } catch {
      // The workspace presents the structured API error; keep the draft open.
    }
  }

  return (
    <article
      className={`block-card ${isSelected ? "is-selected" : ""} ${block.reviewed || acknowledged ? "is-reviewed" : ""}`}
    >
      <div className="block-card-topline">
        <div className="block-meta">
          <span className="block-kind">{KIND_LABELS[block.kind]}</span>
          <span aria-hidden="true" className="meta-dot">·</span>
          <span>Page {block.source.pageNumber}</span>
          <span aria-hidden="true" className="meta-dot">·</span>
          <span>{block.source.extractor === "native_pdf" ? "Native text" : block.source.extractor === "tesseract" ? "OCR" : "Manual"}</span>
        </div>
        <ConfidenceBadge confidence={block.confidence} />
      </div>

      {block.warnings.length > 0 ? (
        <ul className="warning-list" aria-label="Extraction warnings">
          {block.warnings.map((warning) => (
            <li className={`warning-${warning.severity}`} key={`${warning.code}-${warning.message}`}>
              <WarningIcon size={15} />
              <span>{warning.message}</span>
            </li>
          ))}
        </ul>
      ) : null}

      {editing ? (
        <div className="editor-field">
          <label htmlFor={editorId}>Correct extracted text</label>
          <textarea
            autoFocus
            id={editorId}
            onChange={(event) => setDraft(event.target.value)}
            rows={Math.min(12, Math.max(3, draft.split("\n").length + Math.ceil(draft.length / 90)))}
            value={draft}
          />
          {changed ? <p className="edit-note">Only your explicit correction will replace the extracted text.</p> : null}
          <div className="editor-actions">
            <button
              className="button button-small button-primary"
              disabled={busy || !changed || draft.trim().length === 0}
              onClick={save}
              type="button"
            >
              {busy ? <><span className="spinner" /> Saving…</> : "Save correction"}
            </button>
            <button
              className="button button-small button-ghost"
              disabled={busy}
              onClick={() => { setDraft(block.text); setEditing(false); }}
              type="button"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <p className={`block-text block-${block.kind}`}>{block.text || <em>Empty extracted block</em>}</p>
      )}

      {!editing ? (
        <div className="block-actions">
          <button className="inline-action" disabled={busy} onClick={() => { setDraft(block.text); setEditing(true); }} type="button">
            <EditIcon size={16} /> Edit text
          </button>
          {block.reviewed || acknowledged ? (
            <span className="reviewed-label"><CheckIcon size={16} /> Reviewed</span>
          ) : (
            <button className="inline-action confirm-action" disabled={busy} onClick={() => onAcknowledge(block.id)} type="button">
              <CheckIcon size={16} /> Looks correct
            </button>
          )}
        </div>
      ) : null}
    </article>
  );
}
