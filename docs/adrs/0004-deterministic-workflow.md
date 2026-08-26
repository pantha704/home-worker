# ADR-0004: Deterministic workflow with constrained optional analysis

Date: 2026-07-15  
Status: accepted

## Context

Document content can contain prompt injection, and model output is nondeterministic. An agent controlling durable workflow or committing text could violate fidelity and make recovery unpredictable.

## Decision

Code owns validation, state transitions, retries, provider selection, revisions, and rendering. Deterministic rules are the free default. An optional local/remote analysis adapter may classify ambiguous blocks under strict input/output schemas, no arbitrary tools, bounded resources, and explicit provenance. Its output is advisory and cannot directly commit a revision.

## Consequences

The core needs no model/API key and prompt injection has less authority. Some difficult documents require more human review. Future agents remain narrow and evaluated; durable orchestration is never delegated to a language model.
