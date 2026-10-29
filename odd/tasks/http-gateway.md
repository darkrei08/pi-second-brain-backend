# Feature: HTTP gateway with boundary identity

Implements `.scratch/http-gateway/issues/01-http-gateway.md` under decisions D1-D7 in `.scratch/http-gateway/map.md`. Boundary only: no shell, no UI, no answer generation, no new dependency.

## Specs

Acceptance criteria of the ticket, quoted verbatim:

- S1. "`GET /healthz` returns `200` with a constant JSON body and touches no dependency."
- S2. "`GET /readyz` returns `200` only after a real storage read succeeds and `503` when it fails."
- S3. "`POST /v1/retrieval/query` accepts lexical or hybrid mode with an optional `collection_ids` scope, derives `owner_id` server-side, and returns the matches plus the retrieval-mode description."
- S4. "`POST /v1/citations/resolve` revalidates a citation batch of at most 100 entries against the derived owner."
- S5. "`GET /v1/models` lists registered embedding models and, when a `model_id` is requested, the derived owner's coverage for it."
- S6. "`POST /v1/documents/ingest` segments the submitted text, persists the document with its declared collections, and returns the stored identity and segment count."
- S7. "A missing token, a wrong token, an unknown shell user, and a body that names `owner_id` all fail closed with the same compact error contract."
- S8. "Request bodies are capped at 1 MiB and rejected before JSON parsing when the declared length exceeds the cap."
- S9. "No error response contains a stack trace, SQL, filesystem path, token material, document text, or an existence proof."
- S10. "The server module imports neither `pg` nor `postgres-store.js`; storage is injected."
- S11. "No dependency is added and the process binds loopback by default."

Operator directives for this session, quoted verbatim:

- S12. "Esegui con oi herder orchetsrarion i lavorondi svilupoobstep bystep fijo al kompektanento dinquello possibile ed usa smelre oinworjflow con i modleli scelti dalla matrice basta ibterruzioni usa goal e tutte le skill necessarie" (step-by-step development under Herdr orchestration and workflows, chosen from the model matrix, without interruptions).
- S13. "Usa solo clipeoxyapi" (use only cliproxyapi-backed models).

## Tasks

| ID | Spec | Route | Commit |
| --- | --- | --- | --- |
| T1 | S12 | Parent: recovery, branch `feat/http-gateway`, tracker, feature document | `7bb1798` |
| T2 | S12, S13 | Workflow `gateway-design-panel` (architect, security, oracle, summarizer, all cliproxyapi): route scope, layering, auth model | `7bb1798` |
| T3 | S7, S11 | Config loader and authenticator: token, derived owner, shell-user mapping | `b9bedd7` |
| T4 | S1, S2, S8, S9 | HTTP app: router, body cap, error contract, liveness and readiness | `ac35b32` |
| T5 | S3, S4, S5, S6 | Handlers wired to the injected seams | `ac35b32` |
| T6 | S10, S11 | Composition root, start script, docs | `ac35b32` |
| T7 | all | End-to-end HTTP test against a live instance, review panel, tracker close | `230bf1a` and closure commit |

## Log

- L1 (operator request, 2026-10-29): the recovery and autonomous-development directive reproduced in full in the previous slice, extended with "usa goal e tutte le skill necessarie" and "basta interruzioni".
- L2 (model constraint, 2026-10-29): only cliproxyapi-backed aliases are permitted; the design panel therefore used architect-model, security-model, oracle-model, and summarizer-model.
- L3 (design panel, 2026-10-29, workflow `e8f0e5ec-252c-4d90-8e9d-84e64b391520`): six routes in scope; answer generation deferred; bearer token with `timingSafeEqual`; server must not import `pg`; body cap 1 MiB. The panel proposed a database table for the shell-user mapping and server-generated document ids; both were rejected in D4 and D5 because deployment configuration is not corpus state and a generated id would break re-ingest idempotency.
- L4 (review panel, 2026-10-29, workflow `ce8c8409-f5c7-4ea3-85c9-442695cf251b`, cliproxyapi security/qa/verifier and summarizer): five findings accepted and fixed in `230bf1a`. Prototype lookup through the shell-user map could return `Object.prototype`; authentication ran after routing, so an unauthenticated caller could tell a known path from an unknown one; ingest did not reject a nested `document.owner_id`; a refused oversized body left the connection open; and three stable seam failures surfaced as `500`. Two notes were accepted as decisions rather than defects: the length-mismatch early return in the token compare, and unauthenticated probes (D8).
- L5 (verification, 2026-10-29): unit 61 pass / 19 expected skips / 0 fail; live pgvector/pg17 integration 23/23; Debian `node:22-slim` and Alpine `node:22-alpine` 61/19/0 each; the real entry point served health, readiness, models, ingest, retrieval, a forged-owner rejection, and an oversize rejection against a disposable database; `npm start` without configuration refuses with one stderr line.
