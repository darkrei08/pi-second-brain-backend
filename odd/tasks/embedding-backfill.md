# Embedding backfill planning

Expose the missing-coverage work list so a provider-neutral embedding worker can fill partial model coverage over the existing document-scoped write seam.

## Specs

- S1: "MASTER PROMPT — Wayfinder Development Recovery & Autonomous Orchestration"
- S2: "Do not restart the project from scratch. Preserve existing architectural decisions and avoid duplicating completed work."
- S3: "Proceed autonomously through reversible, authorized development and verification steps."
- S4: "Backfill planner (consigliato)"

## Tasks

- T1 | S1-S4 | Recover the verified state, confirm the frontier, and define the backfill wayfinder | route: `.scratch/embedding-backfill`, `odd/traceability.md` | commit: `41d6420`
- T2 | S2-S4 | Add `listEmbeddingBackfill` with pre-DB validation and owner/retention scoping, plus the registered-model repair path in `saveSegmentEmbeddings` | route: `src/postgres-store.js`, `test/integration/postgres-store.test.js` | commit: `d7d92d3`
- T3 | S2-S4 | Document the planning seam, its document-level write invariant, and the repair rule | route: `docs/retrieval-and-graph.md` | commit: `d7d92d3`
- T4 | S1-S4 | Verify host, pgvector integration, container matrix, write-path review, and documentation audit | route: tests and checks | commit: `d7d92d3`

## Log

- L1: MASTER PROMPT — Wayfinder Development Recovery & Autonomous Orchestration
- L2: Recovered clean `feat/model-registry-lifecycle` at `90e9b2b`; the model registry Wayfinder is closed and the documented next frontier is the execution lifecycle.
- L3: Verified baseline before any edit: host `npm test` 17 pass, 9 expected skips, exit 0; live pgvector/pg17 integration 11/11 against a fresh schema created from `docker/postgres/init`.
- L4: Found the reused local `second-brain-stack-postgres-1` volume initialized before `004-embedding-models.sql` and with a different role, so verification uses an isolated throwaway pgvector container on `127.0.0.1:55433` instead of mutating that volume.
- L5: Found `node_modules` untracked-but-not-ignored; added `node_modules/` to `.gitignore` and installed the locked `pg` 8.23.1 outside the repository to keep the worktree clean.
- L6: The user selected the backfill planner slice and authorized `npm ci`-equivalent installation; the frontier decision inside the execution lifecycle is the read-only plan, because provider, routing, generation fencing, and pruning policy are still open.
- L7: Chose a document-level derived plan instead of a job/claim table: `saveSegmentEmbeddings` replaces the whole `(document, model)` set, so a per-segment queue would delete still-valid embeddings, and the missing work is already computable from existing rows.
- L8: Wrote the RED tests first: `storage.listEmbeddingBackfill is not a function` for both the pre-DB validation case and the integration plan case, then implemented the seam and reached 13/13 on an isolated pgvector/pg17 instance.
- L9: An independent review of the first implementation found two major defects: a dimension-mismatched document could never be repaired because the model-wide dimension guard ran before the delete, and that guard was global, so another owner's stale row blocked a clean document. Fixed by skipping the guard only for a complete rewrite of one document for a registered model with the registered dimensions; partial writes and unregistered models keep the legacy guard, which the existing tests still pin.
- L10: A second independent run confirmed the repair path: integration 13/13 twice on one database, 36 concurrent writes on one document leaving a single consistent dimension, and a 60k-segment smoke where `limit 20` plans in 67 ms against 332 ms for `inspectEmbeddingCoverage`. It also found a stale-tracker wording defect and two accuracy defects in the spec and map, all corrected.
- L11: Verification evidence: host `npm test` 18 pass / 10 expected skips; live pgvector/pg17 integration 13/13 (twice); Debian and Alpine Node 22 matrix 18 pass / 10 skips with byte-identical CLI JSON; syntax and privacy checks clean; no provider, worker, credential, corpus, or model cache added.
- L12: Work-unit boundary: implementation and its tests/docs are committed as `d7d92d3` on `feat/embedding-backfill`, with tracker definition in `41d6420` and dependency hygiene in `b0e1e58`. The branch already exceeds the ~400 authored-line slice because it carries the earlier wayfinders from `main`; delivery stays deferred to the operator.
