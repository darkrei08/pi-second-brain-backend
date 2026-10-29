# Model registry and embedding coverage inspection

Define a provider-neutral registry for global embedding models under the selected policy: partial cutover with lexical fallback.

## Specs

- S1: "MASTER PROMPT — Session Recovery, Wayfinder Analysis & Autonomous Development"
- S2: "Do not restart the project, discard existing work or blindly repeat completed tasks."
- S3: "Do not stop after producing an analysis or generic development plan."
- S4: "Proceed with implementation when the next task is clear, safe and unblocked."
- S5: "Modelli globali, fallback parziale"

## Tasks

- T1 | S1-S5 | Recover state, research the blocked frontier, and record the cutover decision | route: `.scratch/model-registry-lifecycle`, `odd/traceability.md` | commit: `de9ca2b`
- T2 | S1-S5 | Add registry schema and storage metadata seams | route: `docker/postgres/init/004-embedding-models.sql`, `src/postgres-store.js` | commit: `ed8c07a`
- T3 | S1-S5 | Add owner-scoped coverage inspection and tests | route: `src/postgres-store.js`, `test/integration/postgres-store.test.js` | commit: `ed8c07a`
- T4 | S1-S5 | Verify regression, PostgreSQL, packaging, container, and repository behavior | route: tests and checks | commit: `ed8c07a`

## Log

- L1: MASTER PROMPT — Session Recovery, Wayfinder Analysis & Autonomous Development
- L2: Recovered clean `feat/database-freshness` at `d0b529c`; database freshness is complete and the remaining frontier is model registry/re-embedding lifecycle.
- L3: Read the existing vector, market-comparison, storage, and traceability contracts. The current embedding table has model IDs and dimensions but no registry or coverage inspection seam.
- L4: Workflow `f68f7187-dcb1-4f92-bd88-d6ef2e0916fc` identified the minimum unresolved decisions: model tenancy, partial vs complete cutover, provider/runtime boundary, stale-worker protection, rollback/decommission TTL, and pruning policy.
- L5: The user selected global models with partial cutover and lexical fallback. This unblocks a metadata/coverage-only Wayfinder while keeping provider execution and active routing deferred.
- L6: Implemented global registry metadata and owner-scoped coverage inspection. Registration is transactional and idempotent for matching metadata; dimensions are immutable; active models can be explicitly deprecated; deprecated models cannot be reactivated; coverage reports active segment, embedded, missing, and dimension-mismatch counts without returning vectors or text.
- L7: Verification passed: host `npm test` 17/17 with 9 expected skips; live pgvector/pg17 integration 11/11; Debian and Alpine Node 22 unit/package checks; syntax, Compose, privacy, package dry-run, and diff checks. Independent review/security found no critical findings and identified documentation/spec/concurrency gaps that were applied and reverified. Native assess was unavailable because untracked files required explicit native selection.
- L8: Work-unit boundary: implementation committed as `ed8c07a`; tracker closure will record the aggregate branch slice threshold already exceeded by prior Wayfinders. Provider integration, workers, routing, stale-worker generations, rollback/pruning, and ANN remain deferred.
