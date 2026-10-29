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
| T1 | S2 | `.scratch/gateway-clients/map.md`: decide and document streamed citation/uncertainty reporting; independent review before any streaming implementation | pending |
| T2 | S2 | `.scratch/gateway-clients/issues/01-chat-completions.md`: test-first buffered OpenAI chat-completions route, docs, and native review | pending |
| T3 | S2 | If T1 decision survives review: provider and gateway streaming implementation with final answer metadata; otherwise document the reviewed alternative | pending |
| T4 | S3 | Standalone Open WebUI inlet filter and Pipe, tests without shell, runtime verification boundary docs, native review | pending |
| T5 | S4 | Record evidence-based disposition of TLS, metrics, and packaging in the same map; implement only if scope/acceptance are clear | pending |
| T6 | S5-S7 | Verify all work-unit commits and review acknowledgements, save Engram checkpoints, audit goal closure | pending |

## Log

- L1: "Recover the real state of this repository and continue development autonomously, without asking for confirmation.\n\nRead first, in this order: odd/handoff/next-session.md (authoritative handoff from the session that just closed), odd/traceability.md, the map.md of the newest trackers under .scratch/. Then call mem_context and mem_search for the Engram project second-brain-stack.\n\nThen execute the ODD cycle continuously: pick the next ticket from the ordered list in the handoff, write or update the feature document under odd/tasks/, observe RED, implement the smallest coherent change, keep tests and docs with the code, commit work units on this branch (feat/session-2, stacked on feat/live-answers), run gentle_review under RDD at the end of each work unit, and save an Engram checkpoint per work unit.\n\nOperating rules, non-negotiable:\n- Models: you are running on cliproxyapi/gpt-6-luna:high. Every delegated agent and workflow must use cliproxyapi aliases only, chosen per role, following the failover chains in ~/.pi/agent/ha.json and the role map in ~/.pi/agent/pi-ha-role-groups.json. Opus and Sonnet have failed with account quota errors: start on gpt-6-luna, gpt-5.6-luna or gemini-3.8-flash-high and keep the Anthropic entries as later failover.\n- Use workflows for design panels and reviews; parallel() returns a keyed object, and concurrent agent() calls must come from distinct call sites.\n- Nothing is pushed. Do not push, open pull requests, merge, delete branches or delete worktrees.\n- node_modules in this worktree is a symlink to /tmp/sbs-deps/node_modules; if it is missing, run npm install.\n- The bash tool refuses pipes into head or tail, backgrounded commands and sleep sequences. Prove a server end to end inside one node script.\n\nReport compactly per ticket: task id, outcome, changed files, tests with exact counts and exit codes, blockers, next action."
- L2: The Goal contract superseded the initial streaming-first ticket. The current order is map decision, buffered chat route, independent review of the stream decision, conditional stream implementation, Open WebUI glue, then explicit TLS/metrics/packaging dispositions.
- L3: Repository state was reconciled as clean at `feat/session-2` `c010dbd`, an alias at the handoff commit shared with `feat/live-answers`; nothing was pushed.
