# Repository Guidelines

## Project Structure & Architecture

RINLYN Secretary runs from `web/` on Vercel. Airtable stores business records; Neon PostgreSQL stores sessions, operation journals, LINE bindings, and AI memory.

- `web/src/app/`: routes; `components/`: interface; `domain/`: workflow rules; `server/`: authentication, integrations, and services.
- `web/db/migrations/`, `web/tests/`, and `web/tools/`: migrations, tests, and operational utilities.
- `integrations/n8n/`: LINE AI workflow; `docs/`: schemas and runbooks.
- `apps-script/`, `preview/`, root `tools/`, and root `tests/`: legacy application and offline demo.
- `artifacts/`: ignored local generators/evidence; `output/`: delivered PDFs/videos; `pic/`: user references.

## Build, Test, and Development Commands

Use Node.js 24. From `web/`:

- `npm ci` and `npm run dev`: install dependencies and start development.
- `npm run lint`, `npm run typecheck`, `npm test`: static checks and unit tests.
- `npm run test:integration`: PGlite integration tests.
- `npm run build` then `npm run test:e2e`: production build and Playwright tests.
- `npm run db:migrate`: apply migrations against the configured database.

Root `npm run build`, `npm run preview`, `npm run check`, and `npm test` target the legacy demo, not the Vercel app. Windows PowerShell can use `npm.cmd`.

## Coding Style & Naming

Follow `web/AGENTS.md` and bundled Next.js documentation before changing web code. Use TypeScript, two-space indentation, single quotes, and Biome (`web/biome.json`). Preserve UTF-8 Thai text, `Asia/Bangkok` dates, and existing component conventions.

## Testing Guidelines

Use `node:test` (`*.test.ts`), PGlite, and Playwright as appropriate. Cover ownership, Active/role checks, idempotency, workflow completion, and date boundaries. Use isolated fixtures; browser emulation does not establish physical-device compatibility.

## Configuration & Deployment

Keep secrets in ignored environment files and hosting configuration. Separate development, staging, and production credentials. Vercel Root Directory is `web/`; consult `docs/vercel-production.md` and deployment/recovery runbooks. Early README deployment snapshots may be outdated. Keep authorization server-side and legacy writes paused after cutover.

## Manuals & Videos

Use synthetic data and mocked APIs for captures. Keep A4 manuals with iPhone-framed screenshots. Approved narration uses Thai gTTS, 1.08× speed, without “คะ/ค่ะ”; align visuals to speech. Preserve full videos and split topics at sentence boundaries. Verify decoding, layout, playback, and ZIP links. Local generators live in ignored `artifacts/`; verify availability. Deliver under `output/pdf/` or `output/video/`; topic collections use `output/video/topics/`. Do not restore removed AI chapters without a request.

## Commits & Pull Requests

Use concise imperative subjects, matching history: `Require case person names when creating tasks`. Describe behavior, validation, and relevant issues; include screenshots for interface changes. Stage only intended files.
