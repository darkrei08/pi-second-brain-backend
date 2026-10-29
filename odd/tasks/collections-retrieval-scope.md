# Feature: collections as a retrieval scope

Implements Wayfinder ticket `.scratch/interface-stack/issues/02-collections-as-retrieval-scope.md` after decision V1-V7 in `.scratch/interface-stack/map.md`. Storage and retrieval only: no shell, no HTTP surface, no plugin, no second vector store.

## Specs

Acceptance criteria of ticket 02, quoted verbatim from the ticket:

- S1. "a document has a persisted collection reference and can be ingested into zero, one, or many collections of its owner;"
- S2. "a collection cannot reference a document of another owner, and an unknown or foreign collection fails closed before any write;"
- S3. "lexical, semantic, and hybrid retrieval accept an optional collection scope and return only segments of that collection; without one, each returns exactly what it returns today;"
- S4. "an owner-isolation test proves that a scoped query cannot return another owner's segment or a segment from another collection;"
- S5. "deleting a collection cascades deletion of its collection references/memberships while leaving its documents and embeddings intact;"
- S6. "deleting a document removes its collection references/memberships and its embeddings as today;"
- S7. "the implementation documents rejection of the shell file-id shortcut as the retrieval scope;"
- S8. "existing segmentation, parser, persistence, semantic, hybrid, citation, freshness, registry, coverage, planning, execution, and mode tests remain green;"
- S9. "no shell, plugin, HTTP route, dependency, or second vector store is added."

Ticket scope line, quoted verbatim, fixing the seam list:

- S10. "An optional collection filter on the retrieval seams (`searchSegmentsLexical`, `searchSegmentsSemantic`, `searchSegmentsHybrid`, `listEmbeddingBackfill`), defaulting to no filter so existing behaviour is unchanged."

Operator directives for this session, quoted verbatim:

- S11. "Recover the real project state, preserve verified knowledge, minimize active context, and resume reliable development through coordinated, deterministic workflows."
- S12. "Do not push, merge or create pull requests automatically unless the repository policy or explicit authorization permits it."

## Design decision recorded by this slice

Collection membership is written only by ingest, which replaces a document's membership set with the collections it declares. A `collections` row carries no label: per V2 the shell owns folder names and identity, while this store owns the scope a folder maps to. Owner isolation is a database invariant (composite foreign keys through `documents(document_id, owner_id)` and `collections(collection_id, owner_id)`), not only an application check.

## Tasks

| ID | Spec | Route | Commit |
| --- | --- | --- | --- |
| T1 | S11 | Parent: recovery checkpoint, branch `feat/collections-retrieval-scope`, ticket claimed, feature document | `d9a1610` |
| T2 | S1, S5, S9 | Parent: `docker/postgres/init/005-collections.sql` plus `docs/development.md` init list | `6e296cc` |
| T3 | S1, S2, S3, S10 | Parent, test-first: ingest collection scope, `createCollection`, `deleteCollection`, optional filter on the four seams | `ebec794` |
| T4 | S4, S5, S6 | Parent: integration cases on isolated pgvector | `ebec794` |
| T5 | S7, S8 | Parent: ticket answer, map decision pointer, traceability row | closure commit |
| T6 | S8, S9 | Parent: unit suite, fresh pgvector integration, differential check against the base commit, package/CLI/privacy checks | closure commit |
| T7 | all | Parent: native review under RDD plus an independent verifier for the owner-scope boundary | closure commit |

## Log

- L1 (operator request, 2026-10-29): "Prompt — Context Reset, Wayfinder Recovery & Autonomous Development ... Act as a Senior Software Engineer, Repository Orchestrator and Context-Efficient Development Agent. Your objective is to safely recover the current development state, minimize context consumption, identify the next actionable Wayfinder ticket, and resume implementation using the available orchestration infrastructure." Full directive includes the recovery, wayfinder, orchestration, execution, context and reporting sections.
- L2 (reconciled state, 2026-10-29): branch `feat/embedding-backfill` at `d43b2a5`, clean tree, 3 commits ahead of origin. Unit suite 41 pass / 11 skipped / 0 fail; integration 14/14 against a fresh pgvector pg17 instance. Only open ticket in the tracker is interface-stack 02; ticket 01 is resolved with V1-V7.
- L3 (scope correction, 2026-10-29): the interface-stack decision slice (`c2ed36f`, `2a5fee7`, `d43b2a5`) is complete and unpushed; this slice stacks on it as a new branch rather than amending it.
- L4 (defect found by the new tests, 2026-10-29): the scoped hybrid case returned matches without a segment `id`. Root cause was pre-existing: `mapHybridSearchResult` passed an already-mapped match back through `mapSegment`, which reads `segment_id` and therefore dropped `id`. Fixed by giving the hybrid mapper an explicit field set; a differential probe against the base commit confirms the `id` is the only change to unscoped output. The first attempt spread the already-mapped match and leaked `rank`, `distance`, `model_id`, and `score` inconsistently, so the contract is now explicit and pinned by a key-set assertion.
- L5 (verification, 2026-10-29): host unit 42 pass / 17 expected skips / 0 fail; live pgvector/pg17 integration 21/21 twice on a disposable instance; Debian `node:22-slim` and Alpine `node:22-alpine` 42/17/0 each; differential probe over lexical, semantic, hybrid, and backfill without a scope; `npm pack --dry-run`, `docker compose config`, and a corpus/credential grep clean.
