# Database freshness and citation revalidation

Close the citation time-of-check/time-of-use gap with a bounded PostgreSQL revalidation seam and harden lexical input parity.

## Specs

- S1: "MASTER PROMPT — Session Recovery, Wayfinder Analysis & Autonomous Development"
- S2: "Do not restart the project, discard existing work or blindly repeat completed tasks."
- S3: "Do not stop after producing an analysis or generic development plan."
- S4: "Proceed with implementation when the next task is clear, safe and unblocked."

## Tasks

- T1 | S1-S4 | Recover state, reconcile traceability, and define freshness contract | route: `odd/traceability.md`, `.scratch/database-freshness` | commit: `4b6fc87`
- T2 | S1-S4 | Implement and test `revalidateCitations` plus lexical input parity | route: `src/postgres-store.js`, `test/integration/postgres-store.test.js` | commit: `52c3314`
- T3 | S1-S4 | Verify regression, PostgreSQL, packaging, container, and repository behavior | route: tests and checks | commit: `52c3314`

## Log

- L1: MASTER PROMPT — Session Recovery, Wayfinder Analysis & Autonomous Development
- L2: Recovered clean `feat/citation-resolver` at `7ca9cbf`; completed citation resolver ticket was verified from Git, local tracker, tests, Engram, workflow status, and Herdr state.
- L3: Workflow `52ad8121-5ca6-48c6-a01a-f2bf0fbe109b` selected database freshness/citation revalidation as the next unblocked slice; security evidence identified stale citation/TOCTOU risk and lexical validation parity gaps.
- L4: `odd/traceability.md` records completed requirements, tests, validation evidence, and deferred candidates. Branch is now `feat/database-freshness`.
- L5: Implemented `storage.revalidateCitations(citations, { owner_id })` with fail-closed validation, a bounded parameterized PostgreSQL freshness query, deterministic stale ordering, and lexical owner/limit parity. Added mixed stale-order and lexical-boundary coverage; no schema or dependency changes.
- L6: Verification passed: host `npm test` 17/17 with 8 expected skips; live pgvector/pg17 integration 10/10; Debian and Alpine Node 22 unit/package checks; syntax, Compose config, privacy, package dry-run, and diff checks. Native assess returned medium risk with `reviewDue=false`; parallel review/security found no critical issue and remediation findings were verified.
- L7: Work-unit boundary: implementation and contract closure committed as `52c3314`; the branch already contains earlier completed Wayfinders, so aggregate branch history exceeds the nominal slice threshold. No additional implementation commit is planned for this ticket.
