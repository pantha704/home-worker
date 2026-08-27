"use client";

import { useState } from "react";
import type { Persona, RenderSettings } from "@homeworker/contracts";

import { RefreshIcon } from "@/components/icons";
import { clampSeed } from "@/lib/validation";

interface RenderSettingsPanelProps {
  busy: boolean;
  deleting: boolean;
  personas: Persona[];
  settings: RenderSettings;
  onApply: (settings: RenderSettings) => Promise<void>;
  onDelete: () => void;
}

const INK_COLORS = [
  { name: "Ballpoint blue", value: "#183B73" },
  { name: "Soft black", value: "#202124" },
  { name: "Plum", value: "#4B2D83" },
  { name: "Burgundy", value: "#7B2828" },
];

const PERSONA_SAMPLE: Record<Persona["id"], string> = {
  scholar: "Thoughtful & steady",
  casual: "Loose and lively",
  compact: "Clear & compact",
};

export function RenderSettingsPanel({ busy, deleting, personas, settings, onApply, onDelete }: RenderSettingsPanelProps) {
  const [draft, setDraft] = useState(settings);

  const dirty = JSON.stringify(draft) !== JSON.stringify(settings);

  function update<Key extends keyof RenderSettings>(key: Key, value: RenderSettings[Key]) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  function nextSeed() {
    update("seed", (draft.seed * 1_103_515_245 + 12_345) % 2_147_483_647);
  }

  return (
    <div className="settings-panel">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">Writing style</span>
          <h2>Make the page yours</h2>
        </div>
        {dirty ? <span className="unsaved-dot">Unsaved</span> : null}
      </div>

      <fieldset className="control-group persona-control">
        <legend>Handwriting persona</legend>
        <div className="persona-grid">
          {personas.map((persona) => (
            <label className={`persona-card persona-${persona.id} ${draft.personaId === persona.id ? "is-active" : ""}`} key={persona.id}>
              <input
                checked={draft.personaId === persona.id}
                name="persona"
                onChange={() => update("personaId", persona.id)}
                type="radio"
                value={persona.id}
              />
              <span className="persona-check" />
              <span className="persona-sample">Aa</span>
              <strong>{persona.name}</strong>
              <small>{PERSONA_SAMPLE[persona.id]}</small>
            </label>
          ))}
        </div>
      </fieldset>

      <div className="control-row">
        <fieldset className="control-group">
          <legend>Paper</legend>
          <div className="segmented-control">
            {(["plain", "ruled", "grid"] as const).map((style) => (
              <label className={draft.paperStyle === style ? "is-active" : ""} key={style}>
                <input checked={draft.paperStyle === style} name="paper" onChange={() => update("paperStyle", style)} type="radio" />
                <span className={`paper-icon paper-${style}`} />
                {style[0].toUpperCase() + style.slice(1)}
              </label>
            ))}
          </div>
        </fieldset>

        <fieldset className="control-group">
          <legend>Ink</legend>
          <div className="color-options">
            {INK_COLORS.map((color) => (
              <label key={color.value} title={color.name}>
                <input checked={draft.inkColor.toLowerCase() === color.value.toLowerCase()} name="ink" onChange={() => update("inkColor", color.value)} type="radio" />
                <span style={{ backgroundColor: color.value }} />
                <span className="sr-only">{color.name}</span>
              </label>
            ))}
          </div>
        </fieldset>
      </div>

      <div className="range-grid">
        <label className="range-control">
          <span><strong>Margin</strong><output>{draft.marginMm} mm</output></span>
          <input max="30" min="8" onChange={(event) => update("marginMm", Number(event.target.value))} type="range" value={draft.marginMm} />
        </label>
        <label className="range-control">
          <span><strong>Line spacing</strong><output>{draft.lineSpacing.toFixed(1)}×</output></span>
          <input max="2.5" min="0.8" onChange={(event) => update("lineSpacing", Number(event.target.value))} step="0.1" type="range" value={draft.lineSpacing} />
        </label>
        <label className="range-control">
          <span><strong>Hand size</strong><output>{draft.fontSizePt === 0 ? "persona" : `${draft.fontSizePt} pt`}</output></span>
          <input max="22" min="0" onChange={(event) => update("fontSizePt", Number(event.target.value))} step="0.5" type="range" value={draft.fontSizePt} />
        </label>
      </div>

      <div className="seed-control">
        <label htmlFor="render-seed"><strong>Variation seed</strong><small>Same seed, same page—every time.</small></label>
        <div>
          <input
            id="render-seed"
            inputMode="numeric"
            max="2147483647"
            min="0"
            onChange={(event) => update("seed", clampSeed(Number(event.target.value)))}
            type="number"
            value={draft.seed}
          />
          <button aria-label="Choose next deterministic variation" className="icon-button" onClick={nextSeed} title="Next variation" type="button"><RefreshIcon size={18} /></button>
        </div>
      </div>

      <div className="settings-actions">
        <button className="button button-primary" disabled={!dirty || busy} onClick={() => onApply(draft)} type="button">
          {busy ? <><span className="spinner" /> Rendering…</> : "Apply & refresh preview"}
        </button>
        {dirty ? <button className="button button-ghost" disabled={busy} onClick={() => setDraft(settings)} type="button">Reset</button> : null}
      </div>

      <div className="local-data-control">
        <div><strong>Local project data</strong><small>Remove this project and its uploaded source from this installation.</small></div>
        <button className="delete-project-button" disabled={busy || deleting} onClick={onDelete} type="button">{deleting ? "Deleting…" : "Delete"}</button>
      </div>
    </div>
  );
}
