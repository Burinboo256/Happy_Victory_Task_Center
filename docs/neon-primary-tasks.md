# Neon primary tasks and Airtable mirror

Status: implementation and Staging rehearsal in progress, 24 November 2026. Production is not authorized for this release. The existing Airtable Control Base remains authoritative for users, Active, roles, memberships and Spaces.

## Data ownership

- Neon owns Tasks, Task Updates, Follow-ups and Notifications after an explicit **per-Space** cutover. Workflow/checklists, LINE bindings, AI memory, document links and favorites stay in their existing Neon tables.
- Airtable business Bases become asynchronous inspection copies. Task edits belong in the web application; this version does not ingest edits/deletes made directly in Airtable. Control Base edits still take effect on the next authorization check. No persistent permission cache is introduced.
- The default Space uses its existing operational schema; other Spaces retain separate schemas and Base credentials. Every storage switch verifies environment and Base binding. No cross-Space fallback is permitted.
- Imported record IDs and URLs remain unchanged. New tasks receive stable application IDs with the existing URL format and an `RN-…` display code. `hvr_task_records.airtable_id` maps these to real Airtable records. Do not assume a new web task ID is an Airtable record ID; Airtable's computed Task ID may differ. Existing Request/Operation Key fields provide reconciliation keys.
- No document bytes are stored. Existing attachment URLs are refreshed from Airtable when opening a task with legacy attachments; other task fields remain Neon-owned.

## Reliability and behavior

Migration `016_neon_tasks.sql` adds storage metadata, task records, an immutable versioned outbox, and mirror review audit. It does not activate any Space or change existing tasks. `npm run db:bundle` includes it when creating or migrating operational schemas.

Web and LINE AI task mutations commit task data, update history, mirror events, operation receipt and existing LINE notification triggers in one SQL transaction. Failed operations roll back. The same idempotency key returns the same result; a changed payload is rejected. Existing completion/checklist and ownership rules remain server-side.

The worker serializes delivery per Space without locking user writes while waiting for Airtable. Each event stores its exact field snapshot. Older unfinished/review events block later versions of that record. Child records wait for the parent task's Airtable mapping. Only an allowlist of writable fields is exported; computed fields, attachment URLs and Control permissions are excluded.

Confirmed transient rejection retries with backoff. Ambiguous writes (including a lost response) enter `review` instead of allowing a newer update to overtake them. Review requires an operator to confirm the earlier invocation stopped, record evidence, and compare upstream fields. Matching writes are acknowledged; otherwise the same event is requeued. No event is silently discarded.

Managers see pending/review counts and the latest successful delivery time in the web application. That timestamp alone is not a claim that the entire Base is current; pending/review counts must also be zero. The outbox is not a substitute for independent backups.

## Staging operation

Use staging credentials loaded from an ignored environment file. Never copy production values into staging. `web/tools/neon-tasks.ts` deliberately rejects `APP_ENV=production` and requires environment, Space ID and expected Base ID. It prints counts and identifiers, not task contents or credentials.

From `web/`, with the intended environment already loaded:

```text
npm run db:migrate
npx tsx tools/neon-tasks.ts --environment=staging --space=<UUID> --base-id=<appID> --action=status
npx tsx tools/neon-tasks.ts --environment=staging --space=<UUID> --base-id=<appID> --action=freeze
npx tsx tools/neon-tasks.ts --environment=staging --space=<UUID> --base-id=<appID> --action=import
npx tsx tools/neon-tasks.ts --environment=staging --space=<UUID> --base-id=<appID> --action=activate
npx tsx tools/neon-tasks.ts --environment=staging --space=<UUID> --base-id=<appID> --action=resume
npx tsx tools/neon-tasks.ts --environment=staging --space=<UUID> --base-id=<appID> --action=drain
```

Pause direct Airtable edits and old writers too; a web runtime switch cannot stop Airtable editors. Wait for in-flight requests, resolve pending/review operations, and back up before import. Import compares two complete source snapshots; activation compares the source again to imported data. Both require writes paused. Import refuses an already activated Space. Do not modify migration checksums after applying them.

Use `--action=inspect` to list pending versions/error codes. To reconcile one stopped ambiguous event use `--action=review --kind=tasks --id=<webRecordID> --version=<number> --confirmed-stopped --evidence=<incident-reference>` with the same environment/Space/Base arguments. This is not a bulk retry command.

## Independent scheduling

Best-effort `after()` delivery follows successful web/LINE creation. Persistent recovery must also run independently of user traffic:

- Set a separate, random `TASK_SYNC_SECRET` only in Staging hosting and an n8n Header Auth credential (`Authorization: Bearer …`). Do not reuse LINE/OpenRouter secrets.
- Use a **separate staging workflow**, scheduled every minute. POST to `https://happy-victory-task-center-git-staging-burin.vercel.app/api/internal/task-sync` with JSON `{"workspaceId":"<staging-space-uuid>"}`. Enumerate each activated Space explicitly. The endpoint rechecks the Space and drains at most three events per invocation.
- Retry failed HTTP requests with backoff; monitor nonzero `review`, queue age and missed executions. No task data is needed in the n8n request or response.
- Test a restart and recovery with no open browser. A one-minute interval is an operating target, not a guarantee under backlog or outages. Tune bounded batch size/frequency after measuring quota, worker time and Neon compute usage.
- Vercel Hobby's legacy Cron frequency is insufficient for one-minute recovery. Do not add frequent Cron entries to `vercel.json` or depend solely on page loads.

## Production migration plan — not executed

1. **Approve operating rules:** task edits through the web, permissions through Control Base, expected mirror lag, operator for review incidents, and independent scheduler. Identify any Airtable automations that still write task fields and pause/replace them.
2. **Inventory and backup:** export every operational Base and Control Base; take a matching encrypted Neon backup; record deployment/configuration and credential key references separately. Include mappings, workflow resources, LINE/AI task references and document links. Rehearse restoration into isolated services.
3. **Deploy with Airtable mode retained:** apply the additive migration to every operational schema; verify migrations/checksums, Base bindings and live authorization. No task data moves merely by deployment. Prepare an explicitly targeted production operator tool only after review.
4. **Freeze one pilot Space:** disable web/AI task writes for that Space, pause direct Airtable editors/automations, drain in-flight requests and resolve old journal reservations. Keep all other Spaces unchanged.
5. **Import and reconcile:** compare all four tables, IDs, keys, field hashes and linked users/tasks. Verify task URLs, checklist versions, history visibility and AI/LINE references. Reject orphan links, duplicate keys, missing schema or any source drift; do not switch partially imported data.
6. **Activate and validate:** set only that Space to Neon, reopen writes, create a clearly marked approved test case, test Secretary/Agent ownership, completion rules, notification delivery and mirror recovery. Validate both web ID and Airtable mapping. Monitor first-load and repeat timings separately.
7. **Expand gradually:** move remaining Spaces only after the pilot has no unexplained mismatch, stale mirror or permission regression. Keep source exports and old record IDs. Do not delete/recreate production Bases.
8. **Recovery:** prefer rolling forward or deploying a release that understands Neon mode. Rolling back to a pre-Neon release can write to the wrong source and break new task URLs. Returning to Airtable requires a fresh write freeze, complete delivery/reconciliation, preserved ID aliases and a tested compatibility release; never flip the mode while events are pending/review. A restoration must account for changes after the backup across both systems.

Release blockers: missing independent recovery scheduling, unresolved mirror errors, unverified backups/restoration, incomplete field comparison, or regressions in cross-Space/Active/Agent restrictions. Physical-device and real Google/LINE tests must be distinguished from fixtures or synthetic sessions.

## Performance scope

This release removes Airtable business-record reads/writes from the normal request path. Control authorization remains live, so its latency remains. Task list projections are indexed by owner/parent/status, but the current dashboard and AI compatibility path still loads the complete authorized summary set. Server-side paging with accurate aggregate totals and SQL-based Thai search is a separate follow-up; do not truncate data to simulate a speed improvement.

Relevant references: [Airtable API limits](https://support.airtable.com/articles/7735693959-managing-api-call-limits-in-airtable), [Neon latency](https://neon.com/docs/connect/connection-latency), [Vercel Cron limits](https://vercel.com/docs/schedules/cron-jobs/usage-and-pricing).
