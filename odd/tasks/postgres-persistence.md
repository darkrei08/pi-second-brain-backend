# PostgreSQL persistence vertical slice

Implement the next bounded private-RAG vertical slice: persist the existing deterministic segment contract in loopback PostgreSQL and expose lexical retrieval through a small adapter. Keep the public repository synthetic-only and defer vector generation, parser workers, graph backends, and HTTP clients.

## Specs

- S1: "E dopodiché analizzare se è possibile anche inserire grapi fai per ottenere il grafo di ricerca semantica e se possibile, non solo PostGress SQL come database, ma anche Postgres per la ricerca vettoriale, quant'altro."
- S2: "poi peoseguiamo con implemrazioni se abbiamo finalizzato le rocerhde e tutto lo stack da realozza"

## Tasks

- T1 | S1-S2 | Persist segmented documents and support owner-scoped lexical search | route: `src/postgres-store.js`, `docker/postgres/init/002-schema.sql`, `test/integration/postgres-store.test.js`, `package.json` | commit: 033e14c, ef55308
- T2 | S1-S2 | Verify regression, privacy, loopback, and container behavior | route: tests, repository guard, Docker Compose | commit: 033e14c, ef55308

## Log

- L1: Dimmi esattamente inqnuale stato e iunto e task eravamoa rrivati e dove il wayfineer si era interortto poi peoseguiamo con implemrazioni se abbiamo finalizzato le rocerhde e tutto lo stack da realozza
- L2: Usa pi herder orchestration pi extensinle workflow eccetera
- L3: Reconciled repository state: the platform/graph research and deterministic segmentation slice are complete; the next frontier is PostgreSQL document/segment persistence with lexical search. Qdrant, Apache AGE, parser workers, embeddings, object storage, Valkey, gateway, and client packaging remain deferred until their evidence and contracts are ready.
- L4: Implemented and verified the PostgreSQL persistence slice in commits 033e14c and ef55308. The adapter is transactional, owner-scoped, lexical-searchable, synthetic-only, and keeps vector, graph, parser, gateway, and client work deferred.
- L5: Work-unit boundary: the four-commit slice is closed at 1970618 after tracker reconciliation and verification. The next implementation slice must be planned separately rather than appended to this commit group.
- L6: The next dependency-ordered Wayfinder is `.scratch/parser-normalization/`, not vector indexing: parser/layout provenance is still missing, while embedding dimension and model family remain provisional.
