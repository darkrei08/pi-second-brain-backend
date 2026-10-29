# OpenAI-compatible embedding provider boundary

Fill the `embed` injection point consumed by the backfill worker with an OpenAI-compatible HTTP adapter, keeping vendor, endpoint, and credential outside the repository.

## Specs

- S1: "Resume Development — Wayfinder"
- S2: "Evita duplicazioni e implementazioni già presenti."
- S3: "Prosegui autonomamente con implementazione, correzioni, refactoring e test."
- S4: "Verifica ogni implementazione prima di considerarla completata."
- S5: "Mantieni le modifiche locali fino alla stabilizzazione, senza effettuare push, merge o operazioni distruttive non autorizzate."

## Tasks

- T1 | S1-S2 | Recover the checkpoint and define the provider-boundary wayfinder | route: `.scratch/embedding-provider-boundary` | commit: `pending-definition`
- T2 | S2-S4 | Add `createOpenAICompatibleEmbedder` with injected fetch, secret-safe errors, and response validation | route: `src/embedding-client.js`, `src/index.js`, `test/embedding-client.test.js` | commit: `pending-implementation`
- T3 | S3-S4 | Document the adapter, its protocol rationale, and its limits | route: `docs/retrieval-and-graph.md` | commit: `pending-implementation`
- T4 | S1-S5 | Verify host suite, container matrix, secret leakage, and composition with the worker | route: tests and checks | commit: `pending-implementation`

## Log

- L1: Resume Development — Wayfinder
- L2: Recovered clean `feat/embedding-backfill` at `f2c20e3`; host `npm test` 26 pass / 11 expected skips before any edit.
- L3: The documented frontier needs a provider. The protocol is already decided by the project (`docs/implementation-brief.md`, `README.md`: customer-owned OpenAI-compatible endpoints); the vendor is deployment configuration, so an adapter is implementable without a product decision.
- L4: The only unblocked injection point is the `embed` function of `runEmbeddingBackfill`, so this slice fills it instead of adding a runtime, scheduler, or credential store.
- L5: Carried forward from the previous audit: `segment_embeddings.model_id` has no foreign key to `embedding_models` and semantic search does not require a registered model. It stays an open decision because requiring registration would change the public write contract and break models written before the registry existed.

- L6: The first adversarial review (canonical `reviewer-model`) rejected the draft with two critical defects: a credential-bearing `base_url` leaked the key through a fetch `TypeError`, and control characters in `api_key` surfaced in a `Headers` error. It also found unrefused redirects, an index contract that accepted duplicates, gaps, and partial indexing, a masked timeout cause, and a plaintext rule that only fired when a key was set.
- L7: Fixed all of them: the endpoint is rebuilt from `origin` and `pathname` so credentials, query, and fragment cannot survive; the plaintext rule is unconditional off loopback and recognises `127.0.0.0/8`, `::1`, and IPv4-mapped loopback; keys must be printable ASCII without spaces; `redirect: 'error'`; indexes must be a strict permutation; timeouts and transport failures report only their category.
- L8: The second verification round (canonical `verifier-model`) found one more leak path - an arbitrary `error.code` reflected into the message - plus two wording mismatches on timeout scope and the key charset; the code echo is now limited to `^[A-Z0-9_]{1,40}$` and the wording matches the code.
- L9: Verification evidence: `test/embedding-client.test.js` 8/8; full host suite 34 pass / 11 expected skips; Debian and Alpine Node 22 matrix identical with 32 pass / 11 skips and a network-free entry-point import; composition with `runEmbeddingBackfill` asserted in a unit test.
- L10: No third independent round after the final one-line `error.code` guard and wording fixes; local suite green. Retries, rate limits, batching, cost control, credential retrieval, and a live provider call remain deferred.
