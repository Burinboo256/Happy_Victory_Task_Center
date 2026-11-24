# Neon primary tasks and Airtable mirror

Status: RINLYN Production imported/activated and reopened on 24 November 2026. Independent Production n8n scheduling verified on 25 November 2026: nine consecutive successful scheduled runs, latest pending/review both zero. The paused `rinlyn-bu` Space remains paused and in Airtable mode. Airtable Control Base remains authoritative for users, Active, roles, memberships and Spaces.

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

- Use a separate random `TASK_SYNC_SECRET` and n8n Header Auth credential (`Authorization: Bearer …`) for each environment. Do not reuse LINE/OpenRouter secrets.
- The Staging one-minute workflow is for bounded rehearsals and is now unpublished. It proved delivery without browser traffic. Production uses a separate published workflow `N08HJa01GfG2vyl8`, **every 30 minutes**, POSTing to `https://happy-victory-task-center.vercel.app/api/internal/task-sync` with JSON `{"workspaceId":"00000000-0000-4000-8000-000000000001"}`. Include only activated, active Spaces; `rinlyn-bu` is deliberately excluded. The endpoint rechecks the Space and drains at most three events per invocation.
- Ordinary web/AI mutations start best-effort delivery of three events immediately after commit. The 30-minute timer recovers leftovers; it is not a promise that every mirror update takes 30 minutes. In n8n, use a fixed next URL matching the endpoint, stop pagination when `pending === 0`, `review > 0`, `processed === 0`, or `$pageCount >= 19` (maximum 20 calls). Retry HTTP failures three times with five seconds between attempts and a 55-second request timeout. Never paginate to an untrusted response URL with this credential.
- Retry failed HTTP requests with backoff; monitor nonzero `review`, queue age and missed executions. No task data is needed in the n8n request or response.
- Test a restart and recovery with no open browser. A one-minute interval is an operating target, not a guarantee under backlog or outages. Tune bounded batch size/frequency after measuring quota, worker time and Neon compute usage.
- Vercel Hobby's legacy Cron frequency is insufficient for one-minute recovery. Do not add frequent Cron entries to `vercel.json` or depend solely on page loads.

## Production migration procedure

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

### Connection capacity

Application transactions use up to three PostgreSQL connections per warm server instance. Airtable's short rate-limit queries have a separate pool capped at two, for a total ceiling of five per database URL per instance. This prevents live owner checks or mirror HTTP requests from waiting for a connection held by their own transaction. Rate-limit rows still live in the shared control schema and commit before HTTP; no rate-limit row lock is held across the network request. Size Neon connection capacity for the number of concurrent instances before Production, rather than increasing these limits without measurement. See [node-postgres pooling](https://node-postgres.com/features/pooling).

The real PostgreSQL regression fills all three application connections with concurrent Secretary creates, checks owners through the real Airtable client with a synthetic HTTP transport, and verifies that all commits finish. A subsequent Active revocation is rejected. Both pools are closed together by operational tools.

## Staging evidence — 24 November 2026, before Production rollout

- Read-only encrypted PostgreSQL dump and network-isolated restore passed for 63 existing tables and constraints across both operational schemas. Backup run `092ad81a-0e7c-47dd-bef0-bb90cecc6e65`; only Neon-specific `pg_attver` storage statements were stripped from the local restore SQL, while the original archive was preserved. Airtable task snapshots were separately encrypted and verified before import.
- RINLYN imported 15 tasks / 30 updates / 4 followups / 5 notifications; Space B imported 3 / 7 / 1 / 1. Snapshot hashes matched again at activation. No old tasks or Airtable records were deleted/recreated.
- Real Staging HTTP tests used three short-lived synthetic sessions for the existing Secretary/Agent A/Agent B accounts. All were revoked. They verified idempotent creation, ownership, cross-Space rejection, hidden private comments, incomplete-checklist rejection, successful completion after mandatory checklist entries, AI context reads, authenticated worker execution and the final Airtable status. Two clearly marked `[NEON STAGING TEST]` tasks were retained as test evidence. Existing task fields were unchanged.
- Real Staging recovery rehearsal injected a known temporary rejection and then a lost response **only for the marked synthetic task**. The independent HTTP worker recovered the former; field comparison acknowledged the latter without duplication. Pending/review counts finished at zero. This proves the endpoint and durable queue, not the unpublished scheduler or a live LINE OA.
- Latest three HTTP samples: overview/list 1957 / 2042 / 1958 ms; detail 1967 / 1964 / 1983 ms. These are a small sample after warm-up with 16 tasks before the second synthetic creation, not browser paint or a production SLA. Live authorization still accounted for about 1.2 seconds. Earlier post-optimization medians were 2461 / 3082 ms on 15 tasks; data sets and request timing differ, so percentages are indicative only.
- Final code release `41c6513` passed CI [45415924386](https://github.com/Burinboo256/Happy_Victory_Task_Center/actions/runs/45415924386): 39 unit, 85 PGlite integration, 13 PostgreSQL, 92 browser, 21 HTTP API, synthetic load and 69 legacy tests. This includes RN-code matching in LINE task search/memory and the full-connection-pool concurrency regression. The synthetic load uses five users/250 tasks and mocked Airtable, not Production traffic.
- The stable Staging alias was assigned to verified deployment `dpl_13Pch8hAebeJKA5vYL8hQwV1247E`. Final HTTP checks verified effective Space roles (Secretary/Agent), manager-only sync status, and worker authentication. All 66 original business records across four tables/two Spaces matched the encrypted pre-import snapshots; pending/review counts remained zero. Temporary verification sessions were revoked.
- Production alias remained `dpl_HbWZNsLS7kWoPMANkAgYVBXC1osg`; remote `main` remained `a4a924ddaca7beee088fa859d1873700ca169a2e`. No Production database, Base, credentials, configuration or deployment was changed.

Ignored evidence: `artifacts/vercel/neon-staging-{backup-latest,prepare,activate,smoke,recovery,final,schedule-test}.json`. Secret configuration and encrypted snapshots must not be committed. The independent scheduler template is [staging-task-mirror.json](../integrations/n8n/staging-task-mirror.json); attach the staging-only Header Auth credential for a bounded rehearsal, then unpublish it. The actual timed rehearsal subsequently passed: priority changed and was restored on a marked test task with zero direct calls to the worker from the test script. Staging workflow `e0p7m1tMblDHkZjt` is now unpublished to avoid consuming execution/compute quotas continuously.

## ก่อนขึ้น Production — ต้องตรวจร่วมกันก่อน

1. สำรอง Neon และ Airtable ของ **ทุก Space** พร้อมซ้อมกู้คืน โดยเก็บกุญแจแยกจากชุดสำรอง
2. ตรวจผู้ที่แก้ข้อมูลงานใน Airtable และ Automation เดิม ให้ย้ายการแก้งานมาเว็บ; Active/Role/สมาชิก/Space ยังคงแก้ผ่าน Control Base
3. เปิดตัวตั้งเวลา n8n แยกตาม environment และตรวจว่าเรียกเองได้จริงเมื่อไม่มีคนเปิดเว็บ รวมการแจ้งเตือนคิวค้าง
4. วางช่วงพักการเขียนเฉพาะ Space ที่นำร่อง รอคำขอเดิมจบ แล้วนำเข้าข้อมูลและตรวจจำนวน/ฟิลด์/รหัส/Checklist/ประวัติ/ลิงก์เดิมให้ครบ
5. เปิด Neon ทีละ Space เมื่อข้อมูลตรงกันเท่านั้น ทดสอบสิทธิ์และ LINE จริงก่อนขยาย; Airtable เป็นสำเนาที่อาจตามหลังเว็บ จึงต้องดูเวลาซิงก์และรายการค้างประกอบ
6. หากมีปัญหา ให้พัก writes และใช้ release ที่เข้าใจ Neon mode แก้ต่อก่อน ห้ามย้อนเว็บเก่าหรือสลับกลับ Airtable ขณะมีข้อมูลรอซิงก์ การย้อนแหล่งข้อมูลต้อง reconcile ข้อมูลใหม่และรักษาลิงก์งานใหม่ด้วย

เครื่องมือซ้อม `web/tools/neon-tasks.ts` ยังปฏิเสธ environment Production โดยตั้งใจ การย้าย Production ใช้ operator script ที่ตรวจ environment/Base/Space แบบเจาะจง เก็บใน ignored artifacts; ห้ามแก้ guard ของเครื่องมือ Staging เพื่อรันกับ Production โดยตรง

## Production evidence — 24 November 2026

- **Release and scope:** `c0875dd60bbcb64da60215c542595ee0a59e92d1`, deployment `dpl_3p1hGodRNREVCR17e3yHpHYPCTvC`, Production alias verified. Both [Staging CI 45420098937](https://github.com/Burinboo256/Happy_Victory_Task_Center/actions/runs/45420098937) and [main CI 45421782607](https://github.com/Burinboo256/Happy_Victory_Task_Center/actions/runs/45421782607) passed. Migration 016 was additive across both operational schemas; only active `rinlyn` was activated. `rinlyn-bu` remains Control-inactive and Airtable-backed. No paid plan change was made.
- **Backup:** initial encrypted operational backup run `b83c6c4b-13b2-4852-ba9c-2672d5170824` verified 63 tables. A fresh backup after the write freeze, run `457a94ed-f6ac-49a1-881a-85b8fa3b05ca`, verified all 71 tables and constraints in network-isolated PostgreSQL 18.6. AES-GCM round-trip and tamper rejection passed. Original dumps retained; only Neon-specific storage metadata was stripped from local restore SQL. Encryption key is separate from archives. These are local encrypted backups with local restore rehearsals, not a new offsite/cloud restore test.
- **Airtable backup:** run `453c564a-6992-420b-8e69-3fa751563950` exported configured business tables from both Bases, all three Control tables and encrypted configuration. A separate frozen four-table RINLYN snapshot was captured immediately before import. No attachment bytes, live schema definitions or revision history were exported; retain the original Bases and previous native backups.
- **Imported:** 29 tasks, 153 updates, 14 followups, 76 notifications (272 records). Full frozen source/import/activation hash: `92e37282645e93c5785047af401662aeeac7213967f9455584e3d7250a771fa0`. Old IDs, field values and URLs were preserved. Post-activation comparison of every original Neon record passed again. No existing Airtable business record was modified by the migration.
- **Reviewed legacy exception:** the strict importer initially rejected nine updates and four notifications with empty/missing `Task` links. A one-time operator import preserved exactly these 13 identified records verbatim, alongside all linked records. It required the exact encrypted snapshot hash, repeated current source comparisons, empty destination tables, paused writes, no unfinished operations and an explicit ID allowlist with empty links only. No parent was invented and no record was deleted. Detail reads remain parent/ownership-filtered, so these rows are retained history, not visible children of another task. The shared importer still rejects orphans; do not reuse the exception for another Base or snapshot.
- **Access and reopening:** short-lived synthetic sessions exercised the real hosted HTTP authorization for the existing Admin, Secretary and two active Agents. Existing manager task detail worked, Agent lists were owner-filtered, other-owner access was rejected, and the paused Space returned 403. Sessions were revoked. Production reopened with `task_writes=true`, `jobs=false`; mirror pending/review were both zero. Control permissions and user Active values were not changed to make tests pass.
- **Mirror canary:** retained one cancelled, clearly marked `[NEON PRODUCTION TEST]` record, web ID `recwfpFqBrAp1qsTH`, mapped Airtable ID `rec81uzB9euhbosZh`. It was created through the Neon repository solely for storage/delivery verification, without firing user LINE notifications. An authenticated hosted worker acknowledged the event and the mapping persisted. This is a storage probe, not proof of a new live LINE create/notification exchange.
- **Scheduler:** Production workflow `N08HJa01GfG2vyl8` was tested manually against the active Space and published at a 30-minute interval with bounded pagination. The paused Space was removed after a test correctly returned 403. Staging timer delivery was independently proven and its workflow subsequently unpublished. The browser interruption on 24 November was resolved on 25 November; timed Production executions are now verified below. The LINE AI workflow was not changed for this verification.
- **Integration limits:** anonymous bootstrap returns 401; Google authorization initiation has the correct Production client/callback; LINE AI accepts a signed empty event; notification OA credential identifies the intended bot. No fresh interactive Google Login, physical-device test or actual LINE message was performed in this rollout. Later local requests to Airtable timed out while hosted Vercel checks continued to pass; no credentials or network security settings were changed to work around that.

Ignored operator/evidence files: `artifacts/neon-production-{cutover,import-preserved-history,verify,hosted-check,reopen}.mts`, `artifacts/backup-neon-production.mjs`, and corresponding `artifacts/vercel/neon-production-*.json`. Keep the encrypted source snapshots, operational backups and separate key available before any recovery. Scripts containing the reviewed exception are not generic migration tools.

For follow-up checks, inspect the hosted sync status and n8n executions first. A paused Space must not be added to the scheduler or automatically activated. For a newly activated Space, complete its own import/verification and explicitly add its UUID to the environment-specific workflow. If pending events grow or review is nonzero, use the incident procedure above; never clear outbox records to make the display look healthy.

## Production scheduler verification — 25 November 2026

The live n8n execution list shows nine successful runs at 30-minute intervals: 24 November 22:53:03, 23:23:03, 23:53:03; 25 November 00:23:03, 00:53:03, 01:23:03, 01:53:03, 02:23:03 and 02:53:03 (Asia/Bangkok), execution IDs 1452–1460. These are the timed runs after publishing, separate from manual preflight execution 1448. Historical errors 1436/1438 preceded the corrected published version; they were retained as diagnostic history.

[Execution 1460](https://rinlyn.app.n8n.cloud/workflow/N08HJa01GfG2vyl8/executions/1460) succeeded in 6.8 seconds on published version `d5091bf5-739c-4483-8acf-3da0eafb53f4`. Its `Drain production outbox` node targeted only RINLYN UUID `00000000-0000-4000-8000-000000000001` and returned `processed=0`, `pending=0`, `review=0`, `lastSyncedAt=2026-11-24T15:37:16.603Z`. The empty response is expected: the prior canary had already been mirrored. It confirms scheduled invocation/authentication and queue inspection, not a newly delivered task in that run. Earlier canary delivery and independent Staging recovery remain separate evidence.

A direct read of Production Neon confirmed `task_writes=true`, `jobs=false`, storage `neon`, and no pending/review events. No new task or LINE message was created during this verification. The independent Production scheduler release gate is closed; continue monitoring missed executions, queue age and review counts during normal operations.
