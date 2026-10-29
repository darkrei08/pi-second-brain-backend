# Feature: gateway clients

Implements the ordered gateway-client work in `.scratch/gateway-clients/map.md` on `feat/session-2`.
Each work unit keeps its tests and docs together, is committed locally, and receives native review under RDD.

## Specs

The active objective, quoted verbatim:

- S1. "Finish the remaining HTTP gateway work on feat/session-2 and keep it verifiable end to end."
- S2. "A written decision in .scratch/gateway-clients/map.md about how a streamed answer reports citations and uncertainty, then POST /v1/chat/completions implemented non-streaming first and streamed only if the decision survives review."
- S3. "The Open WebUI inlet filter and Pipe delivered as reviewed code with tests that run without an installed shell, and a documented statement of what cannot be verified without one."
- S4. "TLS termination, metrics, and deployment packaging each either implemented with evidence or explicitly deferred with a reason in the same map."
- S5. "Every work unit committed on feat/session-2 with tests and docs, native review acknowledged, Engram checkpoint saved."
- S6. "Nothing pushed, no pull requests, no branch or worktree deletion."
- S7. "Report per work unit: task id, outcome, files, test counts with exit codes, blockers, next action."

## Tasks

| ID | Spec | Route | Commit |
| --- | --- | --- | --- |
| T1 | S2 | `.scratch/gateway-clients/map.md`: decide and document streamed citation/uncertainty reporting | `f5a3ee6` |
| T2 | S2 | `.scratch/gateway-clients/issues/01-chat-completions.md`: test-first buffered OpenAI chat-completions route, docs, and native review | `f5a3ee6` |
| T3 | S2 | Independent workflow review of C3; accepted with final metadata only after revalidation | `f5a3ee6` + workflow `122645ae-74d7-40fc-8f2f-b13fae442fd0` |
| T4 | S2 | `.scratch/gateway-clients/issues/02-streaming-chat-completions.md`: upstream SSE adapter, incremental gateway stream, metadata/error/cancel behavior, tests, docs, native review | pending |
| T5 | S3 | Standalone Open WebUI inlet filter and Pipe, tests without shell, runtime verification boundary docs, native review | pending |
| T6 | S4 | Record evidence-based disposition of TLS, metrics, and packaging in the same map; implement only if scope/acceptance are clear | pending |
| T7 | S5-S7 | Verify all work-unit commits and review acknowledgements, save Engram checkpoints, audit goal closure | pending |

## Log

- L1: "Recover the real state of this repository and continue development autonomously, without asking for confirmation.\n\nRead first, in this order: odd/handoff/next-session.md (authoritative handoff from the session that just closed), odd/traceability.md, the map.md of the newest trackers under .scratch/. Then call mem_context and mem_search for the Engram project second-brain-stack.\n\nThen execute the ODD cycle continuously: pick the next ticket from the ordered list in the handoff, write or update the feature document under odd/tasks/, observe RED, implement the smallest coherent change, keep tests and docs with the code, commit work units on this branch (feat/session-2, stacked on feat/live-answers), run gentle_review under RDD at the end of each work unit, and save an Engram checkpoint per work unit.\n\nOperating rules, non-negotiable:\n- Models: you are running on cliproxyapi/gpt-6-luna:high. Every delegated agent and workflow must use cliproxyapi aliases only, chosen per role, following the failover chains in ~/.pi/agent/ha.json and the role map in ~/.pi/agent/pi-ha-role-groups.json. Opus and Sonnet have failed with account quota errors: start on gpt-6-luna, gpt-5.6-luna or gemini-3.8-flash-high and keep the Anthropic entries as later failover.\n- Use workflows for design panels and reviews; parallel() returns a keyed object, and concurrent agent() calls must come from distinct call sites.\n- Nothing is pushed. Do not push, open pull requests, merge, delete branches or delete worktrees.\n- node_modules in this worktree is a symlink to /tmp/sbs-deps/node_modules; if it is missing, run npm install.\n- The bash tool refuses pipes into head or tail, backgrounded commands and sleep sequences. Prove a server end to end inside one node script.\n\nReport compactly per ticket: task id, outcome, changed files, tests with exact counts and exit codes, blockers, next action."
- L2: The Goal contract superseded the initial streaming-first ticket. The current order is map decision, buffered chat route, independent review of the stream decision, conditional stream implementation, Open WebUI glue, then explicit TLS/metrics/packaging dispositions.
- L3: Repository state was reconciled as clean at `feat/session-2` `c010dbd`, an alias at the handoff commit shared with `feat/live-answers`; nothing was pushed.
- L4: T1/T2 committed as `f5a3ee6` (`feat(gateway): add buffered chat completions`): 7 files, 301 insertions, 3 deletions. TDD evidence: targeted gateway tests RED at 0/2 (the route returned 404), then GREEN at 2/2; final `npm test` 82 passed / 22 expected skips / 0 failed (exit 0); isolated pgvector/pg17 integration 26/26 (exit 0), including the real HTTP/database route using a fake provider. Native review `review-08f4a41323737f7f` approved and was acknowledged; one informational assertion-message suggestion was non-blocking. No real provider call was tested.
- L5: T3 reviewed C3 through workflow `122645ae-74d7-40fc-8f2f-b13fae442fd0`, using the `architect`, `security`, `reviewer`, and `summarizer` roles with explicit cliproxyapi models. All three reviewers approved the final-chunk `answer_metadata` contract. They require metadata and `[DONE]` only after citation revalidation, sanitized post-header failures, and clear documentation that strict clients may ignore the extension. Ticket `.scratch/gateway-clients/issues/02-streaming-chat-completions.md` is claimed; implementation had not started at that checkpoint.
- L6: T4 streaming implementation is complete and verified, pending commit/review. RED was observed at 33 pass / 5 fail / 0 skip (exit 1) for missing streaming behavior; after implementation, focused suites passed 42/42 (exit 0), `npm test` passed 91 / skipped 22 / failed 0 (exit 0), and disposable pgvector/pg17 integration passed 26/26 (exit 0), including real DB/HTTP streaming with a fake provider. A base-vs-change authenticated `/v1/answers` differential returned byte-identical status and body. The test container and differential scratch copy were removed. `.scratch/gateway-clients/issues/02-streaming-chat-completions.md` acceptance criteria are checked; real provider and Open WebUI shell remain unverified.
