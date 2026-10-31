# Feature: risk register

Build a source-grounded risk register for the delivered stack on `feat/session-2`.
Record evidenced dispositions, exposure ranking, verification commands, review, and a local commit.

## Specs

- S1. “Create .scratch/risk-register/map.md (destination, how a risk is scored, exit condition) and .scratch/risk-register/issues/01-risk-register.md (Type: audit, Status: claimed), plus odd/tasks/risk-register.md with these candidate risks as starting material.”
- S2. “Verify every claim against the code before keeping it: mark each CONFIRMED with file:line or REJECTED with the reason. Do not copy my wording unverified.”
- S3. “For each risk keep, deliver: threat, affected code path with file:line, control already in place, residual risk, how to verify it today with a command or test, and the smallest mitigation as a follow-up ticket line. Score impact and likelihood as high, medium or low with one line of justification.”
- S4. “Finish with: a ranked list by exposure, the three mitigations worth doing before any deployment, and the risks you rejected with your reason for rejecting them. Commit the work unit on feat/session-2 with the tracker, run native review, save an Engram checkpoint, and do not push.”
- S5. Candidate claims to verify verbatim:
  - “R1 Owner isolation at the HTTP boundary: one shared bearer token, and x-shell-user-id is trusted from the caller, so a token holder can act as any mapped shell user. No rotation, no revocation.”
  - “R2 Corpus egress: question, evidence and answer leave the host for the model provider. Cleartext is loopback-only, but there is no egress allowlist and no audit record of what was sent.”
  - “R3 Prompt injection through retrieved text: bounded and JSON-delimited, plus an instruction to treat it as data, but the model can still be steered and nothing checks entailment.”
  - “R4 A citation [n] proves existence, ownership and freshness, not that the sentence is supported, so uncertainty measures citation integrity only.”
  - “R5 Deletion and export coverage: deleteDocument cascades, collections survive, tombstoned documents keep their embeddings, and there is no export path. Check the retention semantics in src/postgres-store.js.”
  - “R6 Resource abuse: no rate limit or concurrency cap, and a 120 s request timeout means a few callers can hold connections while a model call is in flight.”
  - “R7 Supply chain: the Pi extension dependencies report 3 high vulnerabilities, and this repository has no CI at all.”
  - “R8 Deployment: schema changes require recreating the volume (init SQL runs only on an empty volume), so a real deployment faces a destructive upgrade path. No migrations runner, no backup story.”
  - “R9 Tracker drift: the traceability matrix in odd/traceability.md is maintained by hand and can silently disagree with the code.”
  - “R10 Test gaps: no round trip against a real provider, no load test, no adversarial corpus fixture.”

- S6. “R2 Corpus egress: question, evidence and answer leave the host for the model provider. Cleartext is loopback-only, but there is no egress allowlist and no audit record of what was sent.” Implemented as an approved-provider-host allowlist per client (`ANSWER_ALLOWED_HOSTS`, `EMBEDDING_ALLOWED_HOSTS`), fail-closed for any remote host, loopback exempt. Acceptance criteria: `.scratch/risk-register/issues/03-provider-egress-allowlist.md`.
- S7. “R8 Deployment: schema changes require recreating the volume (init SQL runs only on an empty volume), so a real deployment faces a destructive upgrade path. No migrations runner, no backup story.” Implemented as a forward-only runner over the existing init files plus a rehearsed backup/restore. Acceptance criteria: `.scratch/risk-register/issues/04-migrations-and-restore.md`.

## Tasks

- T1 — S2, S5 — Verify each candidate against source/tests and capture exact evidence — route: read-only source audit — status: done — commit: `26bb2760f962c9ede28893ed5d1263e2207b01d6`.
- T2 — S1-S5 — Write the risk map, claimed audit issue, and this task record — route: documentation — status: done — commit: `26bb2760f962c9ede28893ed5d1263e2207b01d6`.
- T3 — S1-S5 — Validate artifacts, commit on `feat/session-2`, run native review, save checkpoint — route: local verification and native review — status: done — commit: `26bb2760f962c9ede28893ed5d1263e2207b01d6`; push: prohibited.
- T4 — S6 — Enforce the approved-provider allowlist for chat and embedding egress — route: developer subagent in an isolated worktree, test-first — status: in_progress — commit: pending.
- T5 — S7 — Add the forward-only migration runner and rehearse backup/restore — route: developer subagent in an isolated worktree, test-first — status: pending — commit: pending.
- T6 — S6, S7 — Native review of each work unit and the tracker closure — status: pending — commit: pending.

## Log

- L1. Queued task, to start only after your current goal and its todos are complete. Do not interleave it with the streaming work.

TASK: build the risk register for the delivered stack.

Create .scratch/risk-register/map.md (destination, how a risk is scored, exit condition) and .scratch/risk-register/issues/01-risk-register.md (Type: audit, Status: claimed), plus odd/tasks/risk-register.md with these candidate risks as starting material. Verify every claim against the code before keeping it: mark each CONFIRMED with file:line or REJECTED with the reason. Do not copy my wording unverified.

R1 Owner isolation at the HTTP boundary: one shared bearer token, and x-shell-user-id is trusted from the caller, so a token holder can act as any mapped shell user. No rotation, no revocation.
R2 Corpus egress: question, evidence and answer leave the host for the model provider. Cleartext is loopback-only, but there is no egress allowlist and no audit record of what was sent.
R3 Prompt injection through retrieved text: bounded and JSON-delimited, plus an instruction to treat it as data, but the model can still be steered and nothing checks entailment.
R4 A citation [n] proves existence, ownership and freshness, not that the sentence is supported, so uncertainty measures citation integrity only.
R5 Deletion and export coverage: deleteDocument cascades, collections survive, tombstoned documents keep their embeddings, and there is no export path. Check the retention semantics in src/postgres-store.js.
R6 Resource abuse: no rate limit or concurrency cap, and a 120 s request timeout means a few callers can hold connections while a model call is in flight.
R7 Supply chain: the Pi extension dependencies report 3 high vulnerabilities, and this repository has no CI at all.
R8 Deployment: schema changes require recreating the volume (init SQL runs only on an empty volume), so a real deployment faces a destructive upgrade path. No migrations runner, no backup story.
R9 Tracker drift: the traceability matrix in odd/traceability.md is maintained by hand and can silently disagree with the code.
R10 Test gaps: no round trip against a real provider, no load test, no adversarial corpus fixture.

For each risk keep, deliver: threat, affected code path with file:line, control already in place, residual risk, how to verify it today with a command or test, and the smallest mitigation as a follow-up ticket line. Score impact and likelihood as high, medium or low with one line of justification.

Finish with: a ranked list by exposure, the three mitigations worth doing before any deployment, and the risks you rejected with your reason for rejecting them. Commit the work unit on feat/session-2 with the tracker, run native review, save an Engram checkpoint, and do not push.

- L2. Read-only source verification completed on `feat/session-2` at HEAD `1c9a2ff`. Retained risks are stated with corrections in the register: R1 mapping is caller-selectable only after the shared bearer token; R2 sends question/evidence outbound but the answer is returned to the host; R3 has prompt-injection controls and an inline hostile-text test but no provider-behavior or entailment proof; R4 validates citation integrity, not semantic support; R5 hard deletion cascades, while tombstone/purged states retain rows and there is no export API; R6 lacks explicit rate/concurrency caps, but the 120-second setting is not evidenced as a model-call timeout; R7's local CI gap is confirmed but the “Pi extension dependencies report 3 high” claim is unsupported here; R8 has no migration runner, but volume recreation is not required or recommended by source; R9's matrix is presently stale; R10 lacks real-provider and load coverage, but an inline hostile evidence fixture exists. CodeGraph was initialized locally because the inherited index belonged to `/root/git/personale`. The parallel source review timed out before producing usable findings; it was not retried, and evidence was checked inline.

- L3. Drafted the destination map and claimed audit issue. The issue contains per-risk evidence, controls, residual risk, scores, verification commands, follow-up lines, ranking, pre-deployment actions, and rejected subclaims. The next task is structural validation, local commit, native review, and checkpoint.

- L4. Structural readback found all required map sections, all R1-R10 records, and the audit/status labels; staged diff check passed. Primary work-unit commit `26bb2760f962c9ede28893ed5d1263e2207b01d6` is on `feat/session-2`. Native review `review-68c6a2cb9f916ec4` assessed the committed range as low/passive, approved it without reviewer captures, and was acknowledged. No tests or provider calls were run because this is documentation-only. The Engram checkpoint is saved. The risk register work unit is complete; no push.

- L5. User directive, 2026-10-31, verbatim: “Primary directive: Recover the real project state, preserve verified knowledge, minimize active context, and resume reliable development through coordinated, deterministic workflows.” and “Do not stop after producing an analysis if an actionable, authorized implementation task exists.” Scope: the residual blockers stated at the end of the previous turn (R2, R5, R8) plus the native review of R1 that was left open. R5 is excluded from this round because physical purge versus tombstone semantics is an irreversible product decision that the user has not taken. R2 and R8 carry no such decision and proceed.
