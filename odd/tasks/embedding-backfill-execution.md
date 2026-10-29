# Provider-neutral embedding backfill execution

Execute the backfill plan with an injected embedder so partial model coverage can be filled without choosing a provider inside the repository.

## Specs

- S1: "MASTER PROMPT — Wayfinder Development Recovery & Autonomous Orchestration"
- S2: "Do not restart the project from scratch. Preserve existing architectural decisions and avoid duplicating completed work."
- S3: "Proceed autonomously through reversible, authorized development and verification steps."
- S4: "Optimize for correctness, continuity, deterministic execution, maintainability, performance, and minimal unnecessary token consumption."

## Tasks

- T1 | S1-S4 | Recover the checkpoint, confirm the frontier, and define the execution wayfinder | route: `.scratch/embedding-backfill-execution` | commit: pending
- T2 | S2-S4 | Add `runEmbeddingBackfill` with injected embedder, stale-plan skip, and exact counters | route: `src/embedding-backfill.js`, `src/index.js`, `test/embedding-backfill.test.js` | commit: pending
- T3 | S2-S4 | Cover the loop against PostgreSQL and document the caller contract | route: `test/integration/postgres-store.test.js`, `docs/retrieval-and-graph.md` | commit: pending
- T4 | S1-S4 | Verify host, integration, container matrix, and independent review | route: tests and checks | commit: pending

## Log

- L1: MASTER PROMPT — Wayfinder Development Recovery & Autonomous Orchestration
- L2: Recovered clean `feat/embedding-backfill` at `5e7a416`; the backfill planning Wayfinder is closed and its ticket is resolved.
- L3: Verified the checkpoint before editing: host `npm test` 18 pass / 10 expected skips, exit 0.
- L4: The next documented frontier (provider/worker boundary, routing, TTL, pruning) is blocked on product decisions. The unblocked part is executing the plan with an injected embedder, which selects no provider and adds no runtime.
- L5: Rejected importing an OpenAI-compatible client, a job queue, and returning segment text from the plan. The worker composes the three existing storage seams and reads text only through the owner-scoped document seam.
