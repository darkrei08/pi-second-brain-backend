# Provider-neutral exact semantic search

Implement the next dependency-ordered RAG slice: store synthetic embeddings per segment/model and perform exact owner-scoped cosine retrieval through PostgreSQL/pgvector without selecting a production model or ANN index.

## Specs

- S1: "Puliscia e ricaricara la sessione e Prosegui con lo scilpppo delle spec analizza do qule ticket dl wayfinder è stto creato e cosa possiamo proseguire a sciluppare usa pi extensible wokrlfow e pi herdr orchetsrartion e tutte le skills necessarie"
- S2: "poi peoseguiamo con implemrazioni se abbiamo finalizzato le rocerhde e tutto lo stack da realozza"

## Tasks

- T1 | S1-S2 | Define provider-neutral vector storage and exact search | route: `.scratch/vector-semantic-search`, `docker/postgres/init/003-segment-embeddings.sql` | commit: 6c2aee4, bb614ef
- T2 | S1-S2 | Implement validated embedding upsert and semantic search | route: `src/postgres-store.js`, `test/integration/postgres-store.test.js` | commit: bb614ef
- T3 | S1-S2 | Verify regression, PostgreSQL, packaging, and container behavior | route: tests and repository guard | commit: bb614ef (verified)

## Log

- L1: Puliscia e ricaricara la sessione e Prosegui con lo scilpppo delle spec analizza do qule ticket dl wayfinder è stto creato e cosa possiamo proseguire a sciluppare usa pi extensible wokrlfow e pi herdr orchetsrartion e tutte le skills necessarie
- L2: Session was summarized and rehydrated through Engram. The parser-normalization Wayfinder is resolved; vector/embedding model and dimension remain the next frontier.
- L3: Pi Extensible Workflow ran parallel pgvector research and security analysis. The selected slice uses an unbounded `VECTOR` satellite table, exact cosine search, strict owner/retention/model filtering, and synthetic-only vectors.
- L4: Reusable-data-search compared AnythingLLM, Dify, RAGFlow, R2R, Onyx, and Khoj using official sources. The comparison preserves this slice and defers product-specific parser, hybrid, citation, ACL, GraphRAG, and UI integration to separate Wayfinders; see `.scratch/rag-market-comparison/`.
- L5: Implementation commit `bb614ef` passed `npm test` (13 pass, 6 expected PostgreSQL skips) and fresh pgvector integration (8/8). Compose config, syntax, package dry-run, diff check, and cleanup passed. The existing Compose volume was not reset after its credential mismatch; an ephemeral port-55433 container was used for integration proof.
- L6: Native review assess was attempted after the committed work unit and returned `nativeRisk: unassessable` because there were no pending changes; it explicitly required a base-ref assessment for already-committed work. No native capture or delivery action was inferred. Engram observations 1878-1879 record the market decision and implementation outcome.
