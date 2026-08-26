# ADR-0001: Local-first modular monolith

Date: 2026-07-15  
Status: accepted

## Context

The core upload→extract→review→render path must work without paid services or credentials. Early load does not justify distributed state, a broker, or multiple datastores.

## Decision

Ship a Next.js web service and one FastAPI modular monolith using SQLite, local object storage, and synchronous thread-pool processing under container resource ceilings. Keep extractor, repository, renderer, and optional-provider modules separable. Add a bounded executor/durable job abstraction before concurrency or horizontal scaling. Docker Compose is the reference runtime.

## Consequences

Setup, privacy, backup, testing, and cost are simpler. One host limits availability and CPU scale; synchronous in-process work limits concurrency and needs explicit interruption recovery/backpressure before public load. PostgreSQL, object storage, and durable workers are introduced only behind interfaces when measured contention, capacity, or availability requires them.
