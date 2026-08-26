# ADR-0002: Immutable canonical IR revisions

Date: 2026-07-15  
Status: accepted

## Context

OCR is uncertain, user corrections are authoritative for output, and exports must be explainable/reproducible. Updating extracted text in place would erase evidence and make silent mutation hard to detect.

## Decision

Normalize all extraction into a versioned canonical IR. Each block includes source text/region, extractor provenance, confidence, warnings, and review status. Source evidence is immutable. An edit creates a complete new revision referencing its parent; an export binds to one immutable revision.

## Consequences

Fidelity audits, conflict detection, retry safety, and reproduction improve. Storage grows with revisions, so structural sharing/compaction may be added without changing logical immutability. Schema changes require compatibility and migration tests.
