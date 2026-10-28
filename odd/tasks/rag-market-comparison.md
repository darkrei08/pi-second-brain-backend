# Market comparison of prebuilt open-source RAG platforms

Research checkpoint for deciding whether an existing self-hosted RAG product should replace or complement the custom local-first P.IVA stack.

## Specs

- S1: "Esegui anche un'analisi dettagliata. Se esistono sul mercato altri software già precompilati, predisposti per eseguire questo RAG. E se necessario appunto poter implementare facendo delle ricerche quest'ultimi nel nostro stack rag eseguendo dei diversi wayfinder di comparazione paragone aggiornamento dei ticket e così via, perché sicuramente qualcosa nel mercato open source già esiste. Esegui utilizzando data Rusable Search il mio stack di ricerca"

## Tasks

- T1 | S1 | Discover and fetch official candidate sources | route: `.scratch/rag-market-comparison/research.md` | commit: 93d457d
- T2 | S1 | Compare candidates against local-first P.IVA contracts | route: `.scratch/rag-market-comparison/spec.md` | commit: 93d457d
- T3 | S1 | Update vector Wayfinder and define follow-up Wayfinders | route: `.scratch/vector-semantic-search`, `.scratch/rag-market-comparison` | commit: 93d457d

## Log

- L1: Esegui anche un'analisi dettagliata. Se esistono sul mercato altri software già precompilati, predisposti per eseguire questo RAG. E se necessario appunto poter implementare facendo delle ricerche quest'ultimi nel nostro stack rag eseguendo dei diversi wayfinder di comparazione paragone aggiornamento dei ticket e così via, perché sicuramente qualcosa nel mercato open source già esiste. Esegui utilizzando data Rusable Search il mio stack di ricerca
- L2: Candidate discovery used bounded search. Official repositories and documentation were then fetched through the local Firecrawl reusable-data-search stack; no candidate was installed and no private data was accessed.
- L3: Initial decision: preserve the custom PostgreSQL/provenance core, reuse parser/retrieval/ACL patterns selectively, and create follow-up Wayfinders before any product-sidecar integration.
- L4: Tracking commit `93d457d` records the comparison and updates the vector Wayfinder. No candidate was installed, benchmarked against the private corpus, or imported into the runtime.
