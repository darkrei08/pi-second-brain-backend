# Model registry and embedding coverage inspection

Define a provider-neutral registry for global embedding models under the selected policy: partial cutover with lexical fallback.

## Specs

- S1: "MASTER PROMPT — Session Recovery, Wayfinder Analysis & Autonomous Development"
- S2: "Do not restart the project, discard existing work or blindly repeat completed tasks."
- S3: "Do not stop after producing an analysis or generic development plan."
- S4: "Proceed with implementation when the next task is clear, safe and unblocked."
- S5: "Modelli globali, fallback parziale"

## Tasks

- T1 | S1-S5 | Recover state, research the blocked frontier, and record the cutover decision | route: `.scratch/model-registry-lifecycle`, `odd/traceability.md` | commit: pending
- T2 | S1-S5 | Add registry schema and storage metadata seams | route: `docker/postgres/init/004-embedding-models.sql`, `src/postgres-store.js` | commit: pending
- T3 | S1-S5 | Add owner-scoped coverage inspection and tests | route: `src/postgres-store.js`, `test/integration/postgres-store.test.js` | commit: pending
- T4 | S1-S5 | Verify regression, PostgreSQL, packaging, container, and repository behavior | route: tests and checks | commit: pending

## Log

- L1: MASTER PROMPT — Session Recovery, Wayfinder Analysis & Autonomous Development
- L2: Recovered clean `feat/database-freshness` at `d0b529c`; database freshness is complete and the remaining frontier is model registry/re-embedding lifecycle.
- L3: Read the existing vector, market-comparison, storage, and traceability contracts. The current embedding table has model IDs and dimensions but no registry or coverage inspection seam.
- L4: Workflow `f68f7187-dcb1-4f92-bd88-d6ef2e0916fc` identified the minimum unresolved decisions: model tenancy, partial vs complete cutover, provider/runtime boundary, stale-worker protection, rollback/decommission TTL, and pruning policy.
- L5: The user selected global models with partial cutover and lexical fallback. This unblocks a metadata/coverage-only Wayfinder while keeping provider execution and active routing deferred.
