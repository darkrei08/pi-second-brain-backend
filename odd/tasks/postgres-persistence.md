# PostgreSQL persistence vertical slice

Implement the next bounded private-RAG vertical slice: persist the existing deterministic segment contract in loopback PostgreSQL and expose lexical retrieval through a small adapter. Keep the public repository synthetic-only and defer vector generation, parser workers, graph backends, and HTTP clients.

## Specs

- S1: "E dopodiché analizzare se è possibile anche inserire grapi fai per ottenere il grafo di ricerca semantica e se possibile, non solo PostGress SQL come database, ma anche Postgres per la ricerca vettoriale, quant'altro."
- S2: "poi peoseguiamo con implemrazioni se abbiamo finalizzato le rocerhde e tutto lo stack da realozza"

## Tasks

- T1 | S1-S2 | Persist segmented documents and support owner-scoped lexical search | route: `src/postgres-store.js`, `docker/postgres/init/002-schema.sql`, `test/postgres-store.test.js`, `package.json` | commit: pending
- T2 | S1-S2 | Verify regression, privacy, loopback, and container behavior | route: tests, repository guard, Docker Compose | commit: pending

## Log

- L1: Dimmi esattamente inqnuale stato e iunto e task eravamoa rrivati e dove il wayfineer si era interortto poi peoseguiamo con implemrazioni se abbiamo finalizzato le rocerhde e tutto lo stack da realozza
- L2: Usa pi herder orchestration pi extensinle workflow eccetera
- L3: Reconciled repository state: the platform/graph research and deterministic segmentation slice are complete; the next frontier is PostgreSQL document/segment persistence with lexical search. Qdrant, Apache AGE, parser workers, embeddings, object storage, Valkey, gateway, and client packaging remain deferred until their evidence and contracts are ready.
