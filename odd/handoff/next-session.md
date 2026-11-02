# Recovery checkpoint

Restated 2026-10-31 at `feat/session-2`. Git, the tracker, and the tests are authoritative; this file is a pointer, not evidence.

## Where the work stands

Repository: `/root/git/personale/pi.dev/second-brain-stack`. Active worktree: `.worktrees/session-2` on `feat/session-2`. Nothing is pushed and there is no pull request; 20 local commits sit above `origin/feat/embedding-backfill`.

Sealed and verified before this checkpoint: segmentation with provenance, parser normalization, PostgreSQL persistence with owner scoping, lexical/semantic/hybrid retrieval with collection scope, citation resolution and revalidation, model registry and coverage, embedding backfill, the OpenAI-compatible embedder, retrieval-mode description, the loopback HTTP gateway with per-principal identity, grounded answers with reported uncertainty, buffered and streaming chat completions, bounded research, and the Open WebUI filter and pipe.

Mitigations delivered from the delivered-stack risk register, each its own commit:

| Risk | State | Evidence |
|---|---|---|
| R1 shared bearer token | done | `f5602b5`; native review `review-c88c8279c7a63750` acknowledged; runtime-proven with two principals |
| R2 provider egress | done | `a98fcd5`; declared-host allowlist, refusals proven at runtime |
| R5 export and purge | done | `0fde30c`; tombstone is documented as non-erasure, purge physically deletes and cascades, export is owner-scoped |
| R6 model-route limits | done | `5e3d631`; bounded concurrency plus a per-owner budget, 429 `model_busy` before any provider call |
| R7 CI gate | done | `7aee02c`; two jobs through `pnpm run verify` and the migration script. The runner is unproven until a push |
| R8 migrations and restore | done | `76fdadb`; `pnpm migrate`, rehearsal recorded in the ticket |
| R9 traceability drift | done | `649cd9d`; two assertions in the normal suite |
| R3, R4, R10 | open by nature | need a controlled real provider, a semantic-support evaluation and a load target |

The register lives in `.scratch/risk-register/` with its map, ranking and per-risk evidence. `odd/traceability.md` carries one row per delivered requirement and its owning commit.

## Next actionable work, in order

1. Delivery: push `feat/session-2` and open the stacked pull request against `feat/live-answers`. No code is waiting on anything else.
2. R10: an opt-in smoke test against a controlled real provider and a bounded load test with a stated concurrency target; R3 and R4 follow the same provider work.
3. Deployment decisions that are not code: scheduled backups and dump retention, log rotation for the audit line, TLS termination, metrics, packaging, and deleting the three orphaned workflow worktrees.
4. Deferred with reasons: graph retrieval (needs entity and relationship provenance), ANN indexes (needs measured workload), parser benchmark, `/v1/search`, `/v1/memory/*`, TLS, metrics, deployment packaging.

## Commands

```bash
pnpm install --frozen-lockfile
pnpm test                       # unit suite; integration cases self-skip
pnpm migrate                    # needs DATABASE_URL
NODE_OPTIONS=--max-old-space-size=1024 node src/gateway-cli.js
```

Integration and rehearsal use a disposable instance, never the developer volume:

```bash
docker run -d --rm --name sbs-test-pg -e POSTGRES_HOST_AUTH_METHOD=trust \
  -e POSTGRES_USER=test -e POSTGRES_DB=test -p 127.0.0.1:55433:5432 pgvector/pgvector:pg17
for f in docker/postgres/init/*.sql; do docker exec -i sbs-test-pg psql -U test -d test -v ON_ERROR_STOP=1 -q < "$f"; done
TEST_DATABASE_URL='postgres://test@127.0.0.1:55433/test' pnpm run test:integration
docker rm -f sbs-test-pg
```

Gateway environment: `DATABASE_URL` plus either `GATEWAY_PRINCIPALS` (JSON array of `{token, owner_id}`) or the legacy `GATEWAY_TOKEN` with `GATEWAY_OWNER_ID`. Optional: `GATEWAY_HOST`, `GATEWAY_PORT`, `EMBEDDING_BASE_URL`, `EMBEDDING_API_KEY`, `EMBEDDING_ALLOWED_HOSTS`, `ANSWER_BASE_URL`, `ANSWER_API_KEY`, `ANSWER_ALLOWED_HOSTS`, `ANSWER_MODEL`. A remote provider host must be declared or startup is refused.

## Recovery checkpoint, 2026-10-31 (third round)

State after a context reset, reconciled against Git and the tracker rather than a summary.

- Branch `feat/session-2`, clean tree, 87 commits ahead of `main`, all local. `origin/main` is at `600a476`. The eleven pushed `feat/<effort>` branches are all merged into this branch, so the newest remote tip is `origin/feat/live-answers` and this branch adds 23 commits on top of it.
- Tracker: 18 effort directories under `.scratch/`, all 29 tickets resolved. No open Wayfinder ticket anywhere, so the frontier is empty and the next work has to come from this document or from the operator.
- Register: R1, R2, R5, R6, R7, R8 and R9 mitigated and verified. R2's residual, the provider-call audit record, closed by ticket 08 in `33bba6d`.
- Native reviews acknowledged: `review-c88c8279c7a63750`, `review-21dfcdd041638060`, `review-1aa4678c6075fe4d`, `review-199214a5c812cfb9`.
- Leftovers to decide on, not deleted: three orphaned `pi-extensible-workflows/*` branches with their worktrees under `/root/.pi/workflows/.../worktrees/`, from runs whose agents failed. Nothing uncommitted lives there.
- Delivery plan: the repository policy is one stacked pull request per Wayfinder with the first targeting `main`. These 23 commits sit on the already-pushed `feat/live-answers` branch, so a single PR against it is the coherent slice; pushing and opening it is the operator's call.
- Environment quirks confirmed again: `git log --not <refs>` without a positive revision returns nothing useful, so use `git rev-list --count <ref>..HEAD`. A commented colon-heavy `lensesReason` is refused as `lenses-invalid`. `START` needs a full 40-character `baseRef`, not `HEAD~1`.

## Delivery and next frontier, 2026-11-02

- Twelve stacked pull requests are open, `main` to `feat/session-2`: `#21`..`#34`. The four newest are `feat/collections-retrieval-scope` (`#31`), `feat/http-gateway` (`#32`), `feat/live-answers` (`#33`) and `feat/session-2` (`#34`). Nothing is merged; the chain merges in order and `main` is never written directly.
- `.scratch/projects-and-chats/map.md` is the active Wayfinder: eight open tickets. The first is `01-folder-to-collection-scope.md`, and five of the eight are blocked by it, because the shell forwards a folder id as a collection reference while no gateway route can create a collection.
- `.scratch/perf-baseline/report.md` holds the R10 numbers: `/v1/answers` p50 33.55 ms and p95 84.49 ms at concurrency 1, and a 50 percent `429 model_busy` rate at concurrency 4 with the shipped default `GATEWAY_MODEL_CONCURRENCY=4`. The real-provider smoke is blocked on a client key and a valid model id for the local proxy, and its embedding route answered `404`.
- `docs/agents/tooling-evaluation.md` records the verdict on the fourteen proposed external projects: nine skips, five defers, no installs. `herdr-app`, `collie`, `hallmark`, `android/skills` and `Spark` each carry the trigger that would revive them.

## Working rules this repository enforces

- ODD: feature document in `odd/tasks/`, verbatim `S#` specs, a `## Log`, a tracker ticket under `.scratch/<effort>/issues/`, test-first with observed RED, one work-unit commit per slice.
- Native review is on. `assess` then `inspect` then `start` with the pertinent lenses, capture the group once (forecast, then `reviewerRunAcknowledged: true`), then `acknowledge-approved`. Use the facade, never raw STATUS.
- `worktree:` in a `parallel` dispatch did not create an isolated worktree on 2026-10-31; verify with `git worktree list` before claiming isolation, and reserve disjoint surfaces.
- Tool quirks: the bash tool refuses pipes into `head`/`tail`, backgrounded commands and `sleep` loops, so use the `log=$(mktemp)` pattern and prove servers inside one node script. `parallel(...)` returns a keyed object.
- Model aliases only from `cliproxyapi`, per role, with the failover matrix in `~/.pi/agent/ha.json`.

## Memory

Engram project `second-brain-stack`. Useful topic keys: `second-brain-stack/recovery-checkpoint`, `second-brain-stack/wayfinder/*`, `second-brain-stack/odd/<feature>/tasks`. Start from `mem_context`, not from a conversation summary.

## Known gaps stated honestly

The Open WebUI plugins are written and unit-tested but never loaded in a shell. No model call has reached a real provider; every one used a fake. No load test exists. The CI workflow has never executed, because executing it needs a push. The purge cannot reach originals, caches, logs or backups outside PostgreSQL, which stays an operator procedure. Nothing is pushed, so the whole stack lives in local branches only, and the branch is far past a single reviewable delivery slice.
