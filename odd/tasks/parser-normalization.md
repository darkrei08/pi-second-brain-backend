# Parser-neutral normalization vertical slice

Implement the next dependency-ordered RAG slice: normalize parser JSON into the existing document/segment contract and preserve page/layout provenance without adding parser runtimes or private data.

## Specs

- S1: "Prosegui con lo scilpppo delle spec analizza do qule ticket dl wayfinder è stto creato e cosa possiamo proseguire a sciluppare usa pi extensible wokrlfow e pi herdr orchetsrartion e tutte le skills necessarie"
- S2: "poi peoseguiamo con implemrazioni se abbiamo finalizzato le rocerhde e tutto lo stack da realozza"

## Tasks

- T1 | S1-S2 | Normalize Docling, MinerU, and PaddleOCR-style JSON | route: `src/parser-adapter.js`, `test/parser-adapter.test.js`, `src/index.js` | commit: 0a99ebb
- T2 | S1-S2 | Project element layout into segment provenance and preserve fallback behavior | route: `src/segment-document.js`, `test/parser-adapter.test.js` | commit: c8bf53f
- T3 | S1-S2 | Verify synthetic-only, regression, packaging, and container behavior | route: tests and repository guard | commit: c8bf53f

## Log

- L1: Prosegui con lo scilpppo delle spec analizza do qule ticket dl wayfinder è stto creato e cosa possiamo proseguire a sciluppare usa pi extensible wokrlfow e pi herdr orchetsrartion e tutte le skills necessarie
- L2: Research and control-plane orchestration selected parser-neutral normalization as the next frontier. Vector indexing remains deferred because embedding dimension/model and ANN choices are not finalized.
- L3: Primary-source research is recorded in `.scratch/parser-normalization/research.md`; parser runtimes and model weights remain outside this public Node slice.
- L4: Implemented and reviewed the pure normalization slice in commits 0a99ebb and c8bf53f. The next vector/embedding slice remains deferred until model family and dimension are decided.
- L5: Work-unit boundary: this parser-normalization slice closes at ec2797d. The next vector/embedding or parser-runtime work must start from a new ticket and commit group.
- L6: The next Wayfinder is `.scratch/vector-semantic-search/`; it defines provider-neutral exact pgvector retrieval without fixing a production model dimension or ANN index.
