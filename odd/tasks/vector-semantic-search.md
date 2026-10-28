# Provider-neutral exact semantic search

Implement the next dependency-ordered RAG slice: store synthetic embeddings per segment/model and perform exact owner-scoped cosine retrieval through PostgreSQL/pgvector without selecting a production model or ANN index.

## Specs

- S1: "Puliscia e ricaricara la sessione e Prosegui con lo scilpppo delle spec analizza do qule ticket dl wayfinder è stto creato e cosa possiamo proseguire a sciluppare usa pi extensible wokrlfow e pi herdr orchetsrartion e tutte le skills necessarie"
- S2: "poi peoseguiamo con implemrazioni se abbiamo finalizzato le rocerhde e tutto lo stack da realozza"

## Tasks

- T1 | S1-S2 | Define provider-neutral vector storage and exact search | route: `.scratch/vector-semantic-search`, `docker/postgres/init/003-segment-embeddings.sql` | commit: pending
- T2 | S1-S2 | Implement validated embedding upsert and semantic search | route: `src/postgres-store.js`, `test/integration/postgres-store.test.js` | commit: pending
- T3 | S1-S2 | Verify regression, PostgreSQL, packaging, and container behavior | route: tests and repository guard | commit: pending

## Log

- L1: Puliscia e ricaricara la sessione e Prosegui con lo scilpppo delle spec analizza do qule ticket dl wayfinder è stto creato e cosa possiamo proseguire a sciluppare usa pi extensible wokrlfow e pi herdr orchetsrartion e tutte le skills necessarie
- L2: Session was summarized and rehydrated through Engram. The parser-normalization Wayfinder is resolved; vector/embedding model and dimension remain the next frontier.
- L3: Pi Extensible Workflow ran parallel pgvector research and security analysis. The selected slice uses an unbounded `VECTOR` satellite table, exact cosine search, strict owner/retention/model filtering, and synthetic-only vectors.
