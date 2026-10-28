# Provider-neutral hybrid retrieval

Implement the next dependency-ordered retrieval slice by fusing the existing PostgreSQL lexical and pgvector semantic searches with deterministic Reciprocal Rank Fusion.

## Specs

- S1: "Puliscia e ricaricara la sessione e Prosegui con lo scilpppo delle spec analizza do qule ticket dl wayfinder è stto creato e cosa possiamo proseguire a sciluppare usa pi extensible wokrlfow e pi herdr orchetsrartion e tutte le skills necessarie"
- S2: "poi peoseguiamo con implemrazioni se abbiamo finalizzato le rocerhde e tutto lo stack da realozza"

## Tasks

- T1 | S1-S2 | Define the hybrid retrieval contract and RRF invariants | route: `.scratch/hybrid-retrieval` | commit: pending
- T2 | S1-S2 | Implement and test `searchSegmentsHybrid` | route: `src/postgres-store.js`, `test/integration/postgres-store.test.js` | commit: pending
- T3 | S1-S2 | Verify regression, PostgreSQL, packaging, container, and repository behavior | route: tests and checks | commit: pending

## Log

- L1: Puliscia e ricaricara la sessione e Prosegui con lo scilpppo delle spec analizza do qule ticket dl wayfinder è stto creato e cosa possiamo proseguire a sciluppare usa pi extensible wokrlfow e pi herdr orchetsrartion e tutte le skills necessarie
- L2: Session rehydrated through Engram, Git, local Wayfinder trackers, Herdr capability inspection, and Pi Extensible Workflow.
- L3: Workflow `c67327e2-45d7-445b-a45c-42feeeeec50a` selected hybrid retrieval as the smallest dependency-safe next slice. Architecture and reliability scouts agreed that exact lexical and semantic primitives are already present and tested.
- L4: The public seam remains `storage.searchSegmentsHybrid`; `src/index.js` continues to export `createStorage`, avoiding an unnecessary standalone export.
