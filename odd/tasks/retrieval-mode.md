# Retrieval mode and lexical fallback

Name how a set of matches was produced (hybrid, lexical, or empty) so the selected partial-coverage policy becomes observable without a coverage query per retrieval or an invented threshold.

## Specs

- S1: "Prosegui con wayfinder per trovare la soluzione congrua"
- S2: "Evita duplicazioni e implementazioni già presenti."
- S3: "Prosegui autonomamente con implementazione, correzioni, refactoring e test."
- S4: "Verifica ogni implementazione prima di considerarla completata."
- S5: "Mantieni le modifiche locali fino alla stabilizzazione, senza effettuare push, merge o operazioni distruttive non autorizzate."

## Tasks

- T1 | S1-S2 | Compare the candidate designs for fallback orchestration and record the choice | route: `.scratch/retrieval-mode` | commit: pending
- T2 | S2-S3 | Add `describeRetrievalMode` with fail-closed rank handling | route: `src/retrieval-mode.js`, `src/index.js`, `test/retrieval-mode.test.js` | commit: pending
- T3 | S3-S4 | Document the mode contract next to the hybrid seam | route: `docs/retrieval-and-graph.md` | commit: pending
- T4 | S1-S5 | Verify host suite, container matrix, and an independent contract review | route: tests and checks | commit: pending

## Log

- L1: Prosegui con wayfinder per trovare la soluzione congrua
- L2: Recovered clean `feat/embedding-backfill` at `8bcd723`; host suite 34 pass / 11 expected skips before any edit.
- L3: The remaining frontier has two classes: operational work blocked on product decisions (worker scheduling, coverage threshold, TTL/pruning, credentials, graph, gateway) and unblocked work. The congruent next slice is the one that completes the policy already chosen at the registry step without inventing a new rule.
- L4: A design review of the first draft found that a `semantic_fallback` flag overclaims: hybrid fusion caps output at `limit`, so semantic candidates can lose the cut and a fully covered model would be labelled degraded. The flag was removed in favour of `semantic_matches`, the contract now states it reports evidence and not coverage, and the integration test feeds real store output through the function.
- L5: Compared three designs. Per-query coverage gate with a percentage threshold: rejected, because coverage costs about 332 ms at 60k segments (67 ms for one plan page) and the threshold would be an invented product rule. Query embedding inside retrieval: rejected, it would put provider credentials inside the storage seam. Pure annotation of matches: chosen, because `searchSegmentsHybrid` already returns `lexical_rank` and `semantic_rank` with `null` for the missing side, and that shape is pinned by an existing integration assertion.
