# Repository Guidelines

## Project Structure & Module Organization

- `apps-script/` contains production Google Apps Script: `.gs` backend services, `Index.html`, `Styles.html`, `Scripts.html`, and `appsscript.json`. Keep task, follow-up, authentication, Airtable, and notification logic in their respective services.
- `preview/Demo.html` supplies the local demo adapter with synthetic data and browser localStorage.
- `tools/` contains preview assembly, the local HTTP server, and syntax checks.
- `tests/` covers backend behavior, LINE integration logic, and preview assembly.
- `docs/` documents deployment, database schema, security checks, and LINE setup. `artifacts/` holds screenshots and packaged exports; `dist/` contains generated preview output. Both are ignored by Git.

## Build, Test, and Development Commands

Use Node.js 20 or newer; no dependency installation is required. Run commands from the repository root:

- `npm run build`: assemble the standalone demo at `dist/index.html`.
- `npm run preview`: build and serve the demo at `http://127.0.0.1:4173/`; override the port with `PORT`.
- `npm run check`: parse backend, frontend, and demo JavaScript and validate the Apps Script manifest.
- `npm test`: run all `tests/*.test.mjs` using Node's built-in test runner.

## Coding Style & Naming Conventions

Follow surrounding formatting: two-space indentation in expanded blocks, semicolons, and single-quoted JavaScript strings. Backend code uses `var`, camelCase functions, and trailing underscores for internal helpers, such as `ownTask_`. Node tools and tests use ES modules (`.mjs`). Keep service filenames descriptive, such as `TaskService.gs`. Preserve Thai interface text and UTF-8 encoding. No formatter or linter is configured; `check` performs syntax validation.

## Testing Guidelines

Use `node:test` with `node:assert/strict`; name files `*.test.mjs` and describe expected behavior in test names. Mock Apps Script services and external APIs through the existing VM harnesses. Cover authorization, ownership, retries, and Bangkok date boundaries when changing related logic. No numeric coverage threshold is configured. Run checks and tests before submitting; verify UI changes in the preview. Follow `docs/security-and-testing.md` for account-level integration checks.

## Commit & Pull Request Guidelines

This checkout has no Git history to establish commit conventions. Use concise, imperative subjects, for example `Fix LINE summary retry handling`. PRs should explain behavior changes, list validation performed, link relevant issues, and include screenshots for UI changes.

## Security & Deployment

Store credentials in Apps Script Script Properties. Keep authorization checks server-side. Deploy only `apps-script/`; the preview is a simulation. Follow `docs/deployment.md` and keep `Asia/Bangkok` timezone behavior consistent.
