# pi-second-brain-backend

The standalone HTTP gateway and PostgreSQL/pgvector storage layer for Pi Second Brain. It owns ingestion, retrieval, citations, migrations, and grounded answers.

## Quick start

Requirements: Node.js 22+ and PostgreSQL with the `vector` extension (the CI service uses `pgvector/pgvector:pg17`).

```sh
npm ci
DATABASE_URL=postgres://127.0.0.1:5432/second_brain npm run migrate
npm test
TEST_DATABASE_URL=postgres://127.0.0.1:5432/second_brain npm run test:integration
```

Start the gateway after configuring its required environment variables:

```sh
npm start
```

The liveness endpoint is `GET /healthz`. Data routes require the configured gateway credentials and a migrated database. The migration command applies the SQL files in `docker/postgres/init/` exactly once.

To accept shell-derived identity, set `GATEWAY_SHELL_CLAIM_SECRET` and keep the shared bearer token on each request. Send `x-shell-user-id`, `x-shell-group-id` (empty or omitted for user-scoped work), `x-shell-claim-expiry` (Unix seconds), and the lowercase hex `x-shell-claim-signature`. The signature is `HMAC-SHA256(secret, user_id + "\\n" + group_id + "\\n" + expiry)`. Valid claims derive `urn:group:<group_id>` or `urn:user:<user_id>`; claims older than now, more than 120 seconds ahead, or with a mismatched signature are refused. Without the claim headers, legacy owner resolution remains unchanged.

## Layout

- `src/`: gateway, storage, ingestion, retrieval, and provider adapters
- `test/`: unit and integration tests
- `scripts/migrate.mjs`: PostgreSQL migration entrypoint
- `docker/postgres/init/`: ordered schema and extension migrations
- `odd/`: backend design and delivery records

The repository is intentionally independent of the documentation repository and does not read `.scratch/` or files outside this checkout.
