# Feature: grounded answers with reported uncertainty

Implements `.scratch/live-answers/issues/01-grounded-answers.md` under decisions A1-A7. Adds one pure use case, one provider adapter shaped like the embedder, and one gateway route.

## Specs

Acceptance criteria of the ticket, quoted verbatim:

- S1. "`answerQuestion` retrieves with the derived owner and the optional collection scope, and accepts an injected chat function."
- S2. "Evidence is numbered and bounded by `limit`; a retrieved segment cannot forge a delimiter or an instruction block."
- S3. "The prompt states that retrieved text is untrusted data, and the instruction block contains no retrieved text."
- S4. "`[n]` citations resolve against the numbered evidence; an out-of-range number is recorded as unresolved and never guessed."
- S5. "Cited spans are revalidated by storage; a stale citation is recorded, not repaired."
- S6. "No evidence means no model call, an explicit insufficient-evidence answer, and `unsupported` uncertainty."
- S7. "An answer with no valid citation, an unresolved citation, or a stale citation reports `high` uncertainty."
- S8. "A lexical-only cited answer reports `low`; a hybrid cited answer with clean citations reports `none`."
- S9. "The chat adapter surfaces a timeout as one stable error and never reads or returns the provider body."
- S10. "`POST /v1/answers` requires the bearer token, derives the owner, rejects a body that names `owner_id`, and answers `503` when no chat adapter is configured."
- S11. "No dependency is added and no corpus, question, or provider body is logged."

Operator directives for this session, quoted verbatim:

- S12. "Attezione ad usare solo i modellindispnivli in clipeoxyapi e oer il rispettivo ruolo ed attenzione usa anche la amtrice di failover quando opus o sonnetnin sono raggiungibile" (only reachable cliproxyapi models, per role, with the failover matrix when Opus or Sonnet are unreachable).
- S13. "Esegui con Pi herder orchetsrarion i lavorondi svilupoobstep bystep fijo al kompektanento dinquello possibile ed usa smelre oinworjflow ... basta ibterruzioni".

## Tasks

| ID | Spec | Route | Commit |
| --- | --- | --- | --- |
| T1 | S13 | Parent: recovery, branch `feat/live-answers`, tracker, feature document | this commit |
| T2 | S12 | Workflow `live-answers-design-panel` (architect gemini-3.8-flash-high, security gpt-6-luna, oracle gpt-5.6-luna, summarizer gemini-3.5-flash-lite; all cliproxyapi) | this commit |
| T3 | S9, S11 | `src/chat-client.js` adapter plus tests | pending |
| T4 | S1-S8, S11 | `src/answer-question.js` use case plus tests | pending |
| T5 | S10 | Gateway route `POST /v1/answers` plus tests | pending |
| T6 | all | End-to-end HTTP test with a fake chat client and a real database; docs; tracker close | pending |

## Log

- L1 (operator request, 2026-10-29): the recovery and autonomous-development directive, with cliproxyapi-only models and the failover matrix for Opus/Sonnet.
- L2 (failover facts, verified from `~/.pi/agent/ha.json` and `cliproxyapi-models.json`): groups `reviewer`, `development`, `testing`, `summary`, `research` exist with ordered entries; `errorHandling.capacityErrorAction` and `quotaErrorAction` are `next_provider`; every listed cliproxyapi model was fresh at fetch time. Because `claude-sonnet-4-6` already failed once with an account quota error, this slice starts every role on a non-Anthropic cliproxyapi model and keeps Opus/Sonnet only as later failover entries.
- L3 (design panel, 2026-10-29, workflow `faae0999-fbdd-4aa7-a03c-921255a9bb1a`): the panel proposed an audit-logging and quota work unit and an OpenAI-compatible chat route in this slice. Both were rejected in A6 and A7: streaming and tool-call semantics are undesigned, and quotas need a policy that does not exist. Accepted from the panel: numbered JSON evidence blocks, a fixed instruction block, unresolved and stale citation tracking, and the `none/low/high/unsupported` uncertainty ladder.
