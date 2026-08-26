# ADR-0003: Deterministic vector rendering

Date: 2026-07-15  
Status: accepted

## Context

Users need a printable A4 result that looks naturally handwritten yet remains faithful, accessible, and reproducible. Full-page generative images can alter text, blur at print resolution, and are difficult to inspect.

## Decision

Render from reviewed IR through one deterministic layout plan using versioned licensed persona packages and a seed. Preview and final PDF share that plan. Output uses vector/text-capable primitives where feasible and always includes an exact typed companion. Generative full-page rewriting is not in the faithful mode.

## Consequences

Text fidelity, A4 geometry, resolution, testing, and provenance improve. Natural variation must be engineered through contextual alternates and bounded correlated variation, not random per-glyph jitter. Renderer/persona upgrades require golden corpus review.
