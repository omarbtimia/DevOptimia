# AGENTS.md

## Project
Next.js 16 (App Router) web app with a Node backend and **Aurora DSQL as the only database**. Local development and Amplify use the same env vars and DB roles; there is no SQLite runtime fallback. Google Sheets/Apps Script/`clasp` were removed; closed projects were removed entirely. Node >= 22.5 required. No test framework; verification is `npm run lint` + `npm run build` plus manual checks.

## Commands
`npm run dev`, `npm run build`, `npm start`, `npm run lint`, `npm run env:check` (reports required env var names/status only, never values), `npm run db:init` (checks Aurora CRUD connection), `npm run db:init:aurora` (one-time admin provisioning), `npm run db:migrate` (applies pending migrations), `npm run db:migrate:status`, `npm run db:grant`, `npm run ui:sync`.

## Database / environment
- `src/lib/dsql.js` signs short-lived IAM tokens with `@aws-sdk/dsql-signer`; `pg` pools are cached by DB role. AWS credentials come from the standard chain (SSO/profile/IAM role), never static keys in `.env.local`.
- `getDb()` returns a CRUD `PgAdapter` (`optimia_crud`); `getReadOnlyDb()` returns a read-only `PgAdapter` (`optimia_read`). Both are async and expose `get/all/run/exec`; `?` and `:named` params become `$1`, `$2`, …
- `optimia_read` has `SELECT` only on `projects`, `categories`, `assignments`, `entries`. It must never read `users`, `sessions`, `audit` or run DDL/DML. The chat directory currently uses `getDb()` because it joins `users.nombre`; do not grant `users` to the read role.
- `scripts/init-aurora.mjs` applies `db/aurora-schema.sql`, registers baseline/state, seeds `admin`/`admin`, creates/maps DB roles and grants permissions. It needs an identity with `dsql:DbConnectAdmin`. Run it once; do not put it in CI or Amplify builds.
- CI validates env names with `npm run env:check` and builds only; it does not connect to Aurora. `.github/workflows/db-migrate.yml` is separate and does connect with an OIDC role that has `dsql:DbConnectAdmin`. Amplify passes app vars to `.env.production`, runs `env:check`, and uses its Compute role at runtime.
- `db/aurora-schema.sql` is the baseline. Later structure changes must add `db/migrations/NNNN_name.sql`; never edit an applied migration, add a new one instead.
- `scripts/migrate-aurora.mjs` uses `scripts/lib/aurora.mjs` to track `schema_migrations`/`schema_state`, enforce checksums, retry OCC `40001/OC001`, and wait for `CREATE INDEX ASYNC` jobs. Each statement runs separately because DSQL forbids multiple DDL statements or mixed DDL/DML in one transaction.
- `scripts/grant-aurora.mjs` reapplies grants after migrations. `optimia_read` must stay limited to `projects`, `categories`, `assignments`, `entries`; it must not read `schema_migrations`, `schema_state`, `users`, `sessions`, or `audit`.
- Destructive migrations require a `-- @destructive` marker and manual `workflow_dispatch` with `allow_destructive=true`.

## UI source of truth
- `legacy/Home.html`, `legacy/Index.html`, `legacy/Config.html` are the visual source. `src/generated/{home,index,config}.{css,markup.js,client.js}` are generated copies rendered by `src/components/LegacyPage.jsx`. **Do not edit generated files**; edit `legacy/` then run `npm run ui:sync`.
- Browser libs (Bootstrap 5.3, Bootstrap Icons, Select2, jQuery, CKEditor 5) are loaded globally in `src/app/layout.jsx`; generated inline scripts run via `next/script` after hydration.
- Navigation in the ported JS uses `window.location.href` to `/`, `/abiertos`, `/config`; there is no `getView`/`document.write` anymore.

## Routing / auth
- `/login` is public. `(app)/layout.js` redirects unauthenticated users to it; `/config` additionally requires global profile `Administrador` (exact string).
- Login accepts `username` or `email`; passwords are scrypt-hashed (`src/lib/crypto.js`), sessions are DB-backed with an httpOnly cookie. Seed user: `admin` / `admin` (landing email `admin@optimia.local`).
- Google OAuth uses `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` and `GOOGLE_REDIRECT_URI` from server env only; CI/Amplify validate presence with `npm run env:check` without printing values.
- `src/components/rpcShim.js` maps legacy `google.script.run.withSuccessHandler(...).withFailureHandler(...).method(args)` to `POST /api/rpc` with `{ method, params }`. Add/change backend methods in `src/lib/rpc.js` → `HANDLERS` using the old Apps Script names (`getAppData`, `cfgGetAll`, `fetchEntries`, `saveOrUpdateEntry`, …).
- Global profiles are exactly `Administrador` and `Usuario`. `Administrador` only unlocks config; it does **not** grant automatic leader powers in `/abiertos`.
- `assignments.rol` is exactly `Líder` or `Colaborador` **per project**. A user may lead several projects and collaborate in others; a project may have several leaders.
- Config write endpoints are Administrador-only. In `/abiertos`, everyone sees only assigned projects; editing others' entries, `VISTA GLOBAL` and Morgan require `Líder` in that project. See `src/lib/permissions.js`. Do not weaken these checks without reason.
- Every mutation (config, entries, notes, delays, login/logout, chat queries) must write an `audit` row via `src/lib/audit.js`; no audit visualization is exposed in the UI yet.

## Data model (`db/aurora-schema.sql`)
- Application tables: `users`, `sessions`, `projects`, `categories`, `assignments`, `entries`, `audit`. Internal migration tables: `schema_migrations`, `schema_state`. README documents every column.
- `users.role` stores `Administrador`/`Usuario`; `assignments.rol` stores `Líder`/`Colaborador`. `users.nombre` is the display name (backfilled from the email local part when missing).
- `projects.lider_email` is legacy compatibility only; derive leaders from `assignments` with `rol='Líder'`.
- `entries` replaces the per-user sheets: one row per `Tarea`/`Subtarea`/`Avance`/`General`, keyed by `owner_email` + `project_id`. No closed-project tables/columns remain.
- Exact state values matter: `No iniciado`, `En proceso`, `Detenido`, `Completado`, `Eliminada` (`normalizarEstado_` in `src/lib/utils.js`). A parent cannot be completed while children are open.
- `observaciones` is a log: `[YYYY-MM-DD]::texto` segments joined by the literal separator `homoplato`; keep that format when touching delay justification or chat context.
- Dates are `YYYY-MM-DD` in `America/Bogota`; audit timestamps are `YYYY-MM-DD HH:mm:ss`.

## Bedrock chat
- `consultarChatLiderBedrock` is in `src/lib/chat.js`; it requires `Líder` in the assignment for `payload.projectId` (not the global profile). Token comes only from `AWS_BEARER_TOKEN_BEDROCK` in `.env.local`. Fallback model is used on HTTP 400/404. Never commit a token.
- SQL governance lives in `src/lib/sqlGovernance.js`: Morgan first receives only allowed project tables/rules and returns one PostgreSQL `SELECT` using `:projectId`/`:hoy`; `chat.js` validates it, executes it via `getReadOnlyDb()` and sends only the result rows back for the final answer. Never expose access tables, credentials, global profiles or audit logs to the model.
