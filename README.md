# pi-second-brain-backend

The standalone HTTP gateway and PostgreSQL/pgvector storage layer for Pi Second Brain. It owns ingestion, retrieval, citations, migrations, and grounded answers.

## Quick start

Requirements: Node.js 22+ and PostgreSQL with the `vector` extension (the CI service uses `pgvector/pgvector:pg17`).

```sh
npm ci
DATABASE_URL=postgres://user:password@127.0.0.1:5432/second_brain npm run migrate
npm test
TEST_DATABASE_URL=postgres://user:password@127.0.0.1:5432/second_brain npm run test:integration
```

Start the gateway after configuring its required environment variables:

```sh
npm start
```

The liveness endpoint is `GET /healthz`. Data routes require the configured gateway credentials and a migrated database. The migration command applies the SQL files in `docker/postgres/init/` exactly once.

## Layout

- `src/`: gateway, storage, ingestion, retrieval, and provider adapters
- `test/`: unit and integration tests
- `scripts/migrate.mjs`: PostgreSQL migration entrypoint
- `docker/postgres/init/`: ordered schema and extension migrations
- `odd/`: backend design and delivery records

The repository is intentionally independent of the documentation repository and does not read `.scratch/` or files outside this checkout.
