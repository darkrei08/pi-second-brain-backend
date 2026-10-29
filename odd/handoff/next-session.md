# Handoff for a fresh session

Written 2026-10-29 by the session that built the gateway and grounded answers. Read this file, then `odd/traceability.md`. Git, tests, and the tracker are authoritative; this file only points at them.

## Repository and branch stack

Repository: `/root/git/personale/pi.dev/second-brain-stack` (public reference docs plus a Node 22 ESM package, only dependency `pg`).

Branches are stacked, one Wayfinder each, and **nothing is pushed** beyond `origin/feat/embedding-backfill`:

```text
main
└─ feat/embedding-backfill            (pushed; interface-stack decision)
   └─ feat/collections-retrieval-scope (local)
      └─ feat/http-gateway             (local)
         └─ feat/live-answers          (local, current)
```

Seventeen local commits are unpushed. Do not push, open a PR, or merge without explicit authorization.

## What is sealed and verified

Segmentation with provenance, parser normalization, PostgreSQL persistence with owner scoping, lexical/semantic/hybrid retrieval with an optional collection scope, citation resolution and revalidation, model registry and coverage, embedding backfill, an OpenAI-compatible embedder, retrieval-mode description, the loopback HTTP gateway with boundary identity (six routes), and grounded answers with reported uncertainty.

Trackers, newest first: `.scratch/live-answers/`, `.scratch/http-gateway/`, `.scratch/interface-stack/`, plus the earlier `.scratch/*` efforts. Every one has a `map.md` with decisions and `issues/` with resolved tickets.

## Next actionable work, in order

1. `POST /v1/chat/completions` with streaming, mapping the OpenAI request shape onto `answerQuestion`. Criterion before starting: decide how streaming interacts with the citation and uncertainty report, because an answer streamed token by token cannot report its citations at the end unless the client tolerates a trailing event. Decision A6 of `.scratch/live-answers/map.md` left it deferred for exactly this reason.
2. The Open WebUI glue from decision V6 of `.scratch/interface-stack/map.md`: one `inlet` filter that forwards `folder_id` as `collection_ids` and one Pipe that exposes research mode. Nothing is installed or configured yet, so this needs an installed shell to be verified honestly.
3. TLS termination, metrics, deployment packaging, and the audit-log/quota policy deferred in A7.
4. Still deferred with reasons: graph retrieval (needs entity and relationship provenance), ANN indexes (needs measured workload), parser benchmark, `/v1/search`, `/v1/memory/*`.

## Commands

```bash
npm test                      # unit suite; integration cases self-skip
NODE_OPTIONS=--max-old-space-size=1024 node src/gateway-cli.js   # needs env below
```

Integration needs a disposable pgvector instance; do not reuse the developer volume:

```bash
docker run -d --rm --name sbs-test-pg -e POSTGRES_HOST_AUTH_METHOD=trust \
  -e POSTGRES_USER=test -e POSTGRES_DB=test -p 127.0.0.1:55433:5432 pgvector/pgvector:pg17
for f in docker/postgres/init/*.sql; do docker exec -i sbs-test-pg psql -U test -d test -v ON_ERROR_STOP=1 -q < "$f"; done
TEST_DATABASE_URL='postgres://test@127.0.0.1:55433/test' npm run test:integration
docker rm -f sbs-test-pg
```

Gateway environment: `DATABASE_URL`, `GATEWAY_TOKEN` (32+ chars), `GATEWAY_OWNER_ID`, optional `GATEWAY_HOST`, `GATEWAY_PORT`, `GATEWAY_SHELL_USERS`, `EMBEDDING_BASE_URL`, `EMBEDDING_API_KEY`, `ANSWER_BASE_URL`, `ANSWER_API_KEY`, `ANSWER_MODEL`.

## Working rules that this repository enforced

- ODD: feature document in `odd/tasks/<feature>.md` with verbatim `S#` specs and a `## Log`, a tracker ticket under `.scratch/<effort>/issues/`, test-first with observed RED, work-unit commits, tracker closed with an `## Answer` and a traceability row.
- Native review under RDD is on. `gentle_review` assess, inspect, start with lenses, capture the reviewer group once (forecast first, then `reviewerRunAcknowledged: true`), then `acknowledge-approved`. Do not run raw STATUS.
- Model selection: cliproxyapi aliases only, per role, with the failover matrix in `~/.pi/agent/ha.json` and the role map in `~/.pi/agent/pi-ha-role-groups.json`. Opus and Sonnet are listed first for reviewer roles but have failed with account quota errors; start on `gpt-6-luna`, `gpt-5.6-luna`, or `gemini-3.8-flash-high` and keep the Anthropic entries as later failover.
- Tooling quirks worth knowing before wasting a run: the bash tool refuses pipes into `head`/`tail`, backgrounded commands, and `sleep` sequences, so prove a server end to end inside one node script; `parallel(...)` returns a keyed object, not an array; concurrent `agent()` calls must come from distinct call sites; an Engram `mem_save` with a stable `topic_key` upserts.

## Memory

Engram project `second-brain-stack`. The useful topic keys are `second-brain-stack/wayfinder/collections-scope`, `second-brain-stack/wayfinder/http-gateway`, `second-brain-stack/wayfinder/live-answers`, `second-brain-stack/recovery-checkpoint`, and `second-brain-stack/odd/<feature>/tasks`. Start from `mem_context` and `mem_search`, not from a conversation summary.

## Known gaps to state honestly

No shell is installed, so folder-to-collection mapping, the filter, and the Pipe are unproven at runtime. The chat adapter was proven with fake providers, never against a real endpoint. Nothing is pushed, so the whole stack lives in local branches only.
