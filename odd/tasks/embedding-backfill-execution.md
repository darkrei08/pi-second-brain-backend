# Provider-neutral embedding backfill execution

Execute the backfill plan with an injected embedder so partial model coverage can be filled without choosing a provider inside the repository.

## Specs

- S1: "MASTER PROMPT — Wayfinder Development Recovery & Autonomous Orchestration"
- S2: "Do not restart the project from scratch. Preserve existing architectural decisions and avoid duplicating completed work."
- S3: "Proceed autonomously through reversible, authorized development and verification steps."
- S4: "Optimize for correctness, continuity, deterministic execution, maintainability, performance, and minimal unnecessary token consumption."

## Tasks

- T1 | S1-S4 | Recover the checkpoint, confirm the frontier, and define the execution wayfinder | route: `.scratch/embedding-backfill-execution` | commit: `f1ab171`
- T2 | S2-S4 | Add `runEmbeddingBackfill` with injected embedder, stale-plan skip, and exact counters | route: `src/embedding-backfill.js`, `src/index.js`, `test/embedding-backfill.test.js` | commit: `17ea8b4`
- T3 | S2-S4 | Cover the loop against PostgreSQL and document the caller contract | route: `test/integration/postgres-store.test.js`, `docs/retrieval-and-graph.md` | commit: `17ea8b4`
- T4 | S1-S4 | Verify host, integration, container matrix, and independent review | route: tests and checks | commit: `17ea8b4`

## Log

- L1: MASTER PROMPT — Wayfinder Development Recovery & Autonomous Orchestration
- L2: Recovered clean `feat/embedding-backfill` at `5e7a416`; the backfill planning Wayfinder is closed and its ticket is resolved.
- L3: Verified the checkpoint before editing: host `npm test` 18 pass / 10 expected skips, exit 0.
- L4: The next documented frontier (provider/worker boundary, routing, TTL, pruning) is blocked on product decisions. The unblocked part is executing the plan with an injected embedder, which selects no provider and adds no runtime.
- L5: Rejected importing an OpenAI-compatible client, a job queue, and returning segment text from the plan. The worker composes the three existing storage seams and reads text only through the owner-scoped document seam.
- L6: Wrote the unit suite first and observed RED (`does not provide an export named 'runEmbeddingBackfill'`), then implemented the module: 7 unit tests green, then an integration test that completes coverage 0/3 to 3/3 and repairs a stale-dimension row through the same loop.
- L7: An independent review of the first implementation found one major coverage gap (the integration test could not detect a vector-to-segment misalignment) and three minor defects: a document leaving active retention between plan and read aborted the page instead of being skipped, the docs said a wrong-length embedder result fails "before any write" when earlier documents are already committed, and the default `limit` of 20 was never asserted. All four are fixed and re-verified locally.
- L8: Investigated a test-fragility defect twice hit in this session: the coverage test asserted that the entire global model registry equals its two fixtures, so any other registered model failed it. The assertion is now filtered to its own fixtures and still proves deterministic ordering.
- L9: Verification evidence: host `npm test` 26 pass / 11 expected skips; live pgvector/pg17 integration 14/14 twice on a fresh schema; Debian and Alpine Node 22 matrix 25 pass / 11 skips with identical subtest results and byte-identical CLI JSON; empirical 0/3 to 3/3 coverage run with the second pass processing zero documents; independent review with every finding fixed.
- L10: Work-unit boundary: definition `f1ab171`, implementation with tests and docs `17ea8b4`, closure in the following commit. Provider selection, credentials, scheduling, retries, routing, TTL, pruning, and ANN remain deferred; the injected embedder is the only provider seam.
