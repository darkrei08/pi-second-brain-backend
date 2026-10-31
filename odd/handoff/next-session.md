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

1. R2's second half: emit an audit record of provider and model metadata per model call without logging evidence text. That is the last code gap in the register.
2. R10: an opt-in smoke test against a controlled real provider and a bounded load test with a stated concurrency target; R3 and R4 follow the same provider work.
3. Deployment decisions that are not code: scheduled backups and dump retention, TLS termination, metrics, packaging, and the chained pull-request plan for the 85-commit branch.
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
