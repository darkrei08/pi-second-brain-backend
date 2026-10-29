# Embedding backfill planning

Expose the missing-coverage work list so a provider-neutral embedding worker can fill partial model coverage over the existing document-scoped write seam.

## Specs

- S1: "MASTER PROMPT — Wayfinder Development Recovery & Autonomous Orchestration"
- S2: "Do not restart the project from scratch. Preserve existing architectural decisions and avoid duplicating completed work."
- S3: "Proceed autonomously through reversible, authorized development and verification steps."
- S4: "Backfill planner (consigliato)"

## Tasks

- T1 | S1-S4 | Recover the verified state, confirm the frontier, and define the backfill wayfinder | route: `.scratch/embedding-backfill`, `odd/traceability.md` | commit: pending
- T2 | S2-S4 | Add `listEmbeddingBackfill` with pre-DB validation and owner/retention scoping | route: `src/postgres-store.js`, `test/integration/postgres-store.test.js` | commit: pending
- T3 | S2-S4 | Document the planning seam and its document-level write invariant | route: `docs/retrieval-and-graph.md` | commit: pending
- T4 | S1-S4 | Verify host, pgvector integration, container matrix, and repository hygiene | route: tests and checks | commit: pending

## Log

- L1: MASTER PROMPT — Wayfinder Development Recovery & Autonomous Orchestration
- L2: Recovered clean `feat/model-registry-lifecycle` at `90e9b2b`; the model registry Wayfinder is closed and the documented next frontier is the execution lifecycle.
- L3: Verified baseline before any edit: host `npm test` 17 pass, 9 expected skips, exit 0; live pgvector/pg17 integration 11/11 against a fresh schema created from `docker/postgres/init`.
- L4: Found the reused local `second-brain-stack-postgres-1` volume initialized before `004-embedding-models.sql` and with a different role, so verification uses an isolated throwaway pgvector container on `127.0.0.1:55433` instead of mutating that volume.
- L5: Found `node_modules` untracked-but-not-ignored; added `node_modules/` to `.gitignore` and installed the locked `pg` 8.23.1 outside the repository to keep the worktree clean.
- L6: The user selected the backfill planner slice and authorized `npm ci`-equivalent installation; the frontier decision inside the execution lifecycle is the read-only plan, because provider, routing, generation fencing, and pruning policy are still open.
- L7: Chose a document-level derived plan instead of a job/claim table: `saveSegmentEmbeddings` replaces the whole `(document, model)` set, so a per-segment queue would delete still-valid embeddings, and the missing work is already computable from existing rows.
