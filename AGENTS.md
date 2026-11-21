# AGENTS.md

## Project
Next.js 16 (App Router) web app with a Node backend and local SQLite. Google Sheets/Apps Script/`clasp` were removed; closed projects were removed entirely. Node >= 22.5 required (`node:sqlite` is used). No test framework; verification is `npm run lint` + `npm run build` plus manual checks.

## Commands
`npm run dev`, `npm run build`, `npm start`, `npm run lint`, `npm run db:init` (creates `data/optimia.sqlite` and seeds `admin`/`admin`), `npm run ui:sync`.

## UI source of truth
- `legacy/Home.html`, `legacy/Index.html`, `legacy/Config.html` are the visual source. `src/generated/{home,index,config}.{css,markup.js,client.js}` are generated copies rendered by `src/components/LegacyPage.jsx`. **Do not edit generated files**; edit `legacy/` then run `npm run ui:sync`.
- Browser libs (Bootstrap 5.3, Bootstrap Icons, Select2, jQuery, CKEditor 5) are loaded globally in `src/app/layout.jsx`; generated inline scripts run via `next/script` after hydration.
- Navigation in the ported JS uses `window.location.href` to `/`, `/abiertos`, `/config`; there is no `getView`/`document.write` anymore.

## Routing / auth
- `/login` is public. `(app)/layout.js` redirects unauthenticated users to it; `/config` additionally requires global profile `Administrador` (exact string).
- Login accepts `username` or `email`; passwords are scrypt-hashed (`src/lib/crypto.js`), sessions are DB-backed with an httpOnly cookie. Seed user: `admin` / `admin` (landing email `admin@optimia.local`).
- `src/components/rpcShim.js` maps legacy `google.script.run.withSuccessHandler(...).withFailureHandler(...).method(args)` to `POST /api/rpc` with `{ method, params }`. Add/change backend methods in `src/lib/rpc.js` → `HANDLERS` using the old Apps Script names (`getAppData`, `cfgGetAll`, `fetchEntries`, `saveOrUpdateEntry`, …).
- Global profiles are exactly `Administrador` and `Usuario`. `Administrador` only unlocks config; it does **not** grant automatic leader powers in `/abiertos`.
- `assignments.rol` is exactly `Líder` or `Colaborador` **per project**. A user may lead several projects and collaborate in others; a project may have several leaders.
- Config write endpoints are Administrador-only. In `/abiertos`, everyone sees only assigned projects; editing others' entries, `VISTA GLOBAL` and Morgan require `Líder` in that project. See `src/lib/permissions.js`. Do not weaken these checks without reason.

## Data model (`src/lib/db.js`)
- Tables: `users`, `sessions`, `projects`, `categories`, `assignments`, `entries`, `audit`. Schema is created idempotently on first `getDb()`. README documents every column.
- `users.role` stores `Administrador`/`Usuario`; `assignments.rol` stores `Líder`/`Colaborador`. `users.nombre` is the display name (backfilled from the email local part when missing). `getDb()` migrates older DBs (`Líder`→`Administrador`, `Colaborador`→`Usuario`, adds `assignments.rol`/`users.nombre` and backfills leaders from `projects.lider_email`).
- `projects.lider_email` is legacy compatibility only; derive leaders from `assignments` with `rol='Líder'`.
- `entries` replaces the per-user sheets: one row per `Tarea`/`Subtarea`/`Avance`/`General`, keyed by `owner_email` + `project_id`. No closed-project tables/columns remain.
- Exact state values matter: `No iniciado`, `En proceso`, `Detenido`, `Completado`, `Eliminada` (`normalizarEstado_` in `src/lib/utils.js`). A parent cannot be completed while children are open.
- `observaciones` is a log: `[YYYY-MM-DD]::texto` segments joined by the literal separator `homoplato`; keep that format when touching delay justification or chat context.
- Dates are `YYYY-MM-DD` in `America/Bogota`; audit timestamps are `YYYY-MM-DD HH:mm:ss`.

## Bedrock chat
- `consultarChatLiderBedrock` is in `src/lib/chat.js`; it requires `Líder` in the assignment for `payload.projectId` (not the global profile). Token comes only from `AWS_BEARER_TOKEN_BEDROCK` in `.env.local`. Fallback model is used on HTTP 400/404. Never commit a token.
