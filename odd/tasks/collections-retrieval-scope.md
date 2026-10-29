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
| T1 | S11 | Parent: recovery checkpoint, branch `feat/collections-retrieval-scope`, ticket claimed, feature document | _this commit_ |
| T2 | S1, S5, S9 | Parent: `docker/postgres/init/005-collections.sql` plus `docs/development.md` init list | _this commit_ |
| T3 | S1, S2, S3, S10 | Parent, test-first: ingest collection scope, `createCollection`, `deleteCollection`, optional filter on the four seams | _this commit_ |
| T4 | S4, S5, S6 | Parent: integration cases on isolated pgvector | _this commit_ |
| T5 | S7, S8 | Parent: ticket answer, map decision pointer, traceability row | _this commit_ |
| T6 | S8, S9 | Parent: unit suite, fresh pgvector integration, differential check against the base commit, package/CLI/privacy checks | _this commit_ |
| T7 | all | Parent: native review under RDD plus an independent verifier for the owner-scope boundary | _this commit_ |

## Log

- L1 (operator request, 2026-10-29): "Prompt — Context Reset, Wayfinder Recovery & Autonomous Development ... Act as a Senior Software Engineer, Repository Orchestrator and Context-Efficient Development Agent. Your objective is to safely recover the current development state, minimize context consumption, identify the next actionable Wayfinder ticket, and resume implementation using the available orchestration infrastructure." Full directive includes the recovery, wayfinder, orchestration, execution, context and reporting sections.
- L2 (reconciled state, 2026-10-29): branch `feat/embedding-backfill` at `d43b2a5`, clean tree, 3 commits ahead of origin. Unit suite 41 pass / 11 skipped / 0 fail; integration 14/14 against a fresh pgvector pg17 instance. Only open ticket in the tracker is interface-stack 02; ticket 01 is resolved with V1-V7.
- L3 (scope correction, 2026-10-29): the interface-stack decision slice (`c2ed36f`, `2a5fee7`, `d43b2a5`) is complete and unpushed; this slice stacks on it as a new branch rather than amending it.
