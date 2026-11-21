# Multi-Space Staging Acceptance

Status on 21 November 2026: CI and browser role acceptance passed for Owner, Secretary, Agent A and Agent B. Production migration has not been executed. The owner explicitly deferred actual LINE testing to their own Production test; do not count that deferral as a test pass. Use synthetic cases only; never move the production OA webhooks to Staging.

## Release and evidence

- Application: `4899bc3`, Vercel Preview `dpl_J5wYQGYuAQQVbzEtA2oFeRDSakdy`, exposed through the stable staging URL.
- [GitHub CI passed all jobs](https://github.com/Burinboo256/Happy_Victory_Task_Center/actions/runs/44789096892).
- Production baseline: `dpl_EkvvhmQC8TX3dVaaVT7rFsdZjtoi`; unchanged during Owner acceptance.
- Ignored evidence: `artifacts/vercel/workspaces-browser-acceptance.json`, `workspaces-role-service-acceptance.json`, and `artifacts/workspaces/` screenshots. These files must not contain or publish authentication secrets.

## Accounts and scope

| Account | RINLYN | Space B | Purpose |
| --- | --- | --- | --- |
| mydreamyoudream@gmail.com | Admin / system Owner | Admin | Space and membership setup |
| burinallianz@gmail.com | Secretary | Secretary | Read, update, internal notes, follow-ups |
| rinlynallianz@gmail.com | Agent | Agent | Own tasks only, independent LINE context |
| sidatacheckup@gmail.com | Agent | No membership | Negative Space access check |

The two Space B memberships above were added for this Staging test. Roles in RINLYN and all Production memberships remain unchanged. Base B contains synthetic test data. Users mirror IDs differ across Bases; central identity stays the same.

## Acceptance matrix

| Scenario | Current evidence | Remaining |
| --- | --- | --- |
| Owner Google login and two Space selector | Browser passed | None for this scenario |
| Add pending member, approve, create task, save/reload checklist | Browser passed with synthetic member/task | None for this scenario |
| Cross-Space task URL | Browser denies in RINLYN, works in Space B | None for this scenario |
| Secretary permissions | Google login passed; both Spaces show Secretary without membership/Owner tools. Browser created a Space B Agent A task, changed status/priority, saved an internal note/follow-up and document draft; no publish control. RINLYN remains 15 tasks and 44 published documents; Space B task is denied there. | None for this scenario |
| Agent A permissions | Google login passed; sees only own task, public updates and summary checklist. No internal note, private follow-up details, edit/status controls, other Agent's task or draft documents. Creates own Space B task with automatic ownership; it is denied when RINLYN is selected. | None for this scenario |
| Agent B outside Space B | Google login passed; selector exposes only RINLYN. Own task opens; Agent A's RINLYN task is forbidden. Direct Space B link says the account has no access. | None for this scenario |
| Task, document and workflow isolation | Owner/Secretary/Agent A/Agent B browser plus live Airtable/Neon checks passed. Agent A sees 44 published RINLYN documents, no add/draft controls, and no Space B drafts. | None for these browser scenarios |
| LINE AI linking and explicit Space selection | Isolated integration tests passed | Deferred by owner to actual Production phone test |
| AI summaries, task drafts, documents and memory | Isolated integration tests passed | Deferred: compare actual LINE replies with each selected Space |
| Old draft/ticket after Space change; revoked membership | Isolated integration tests passed | Deferred: actual LINE confirmation rejection and membership restore |
| LINE new-task and completed-task notifications | Existing automated checks passed | Deferred: actual opt-in, correct recipient/Space, no duplicate sends |

## Live LINE preparation

The owner initially requested a separate test OA, then explicitly deferred LINE testing: they will test in Production personally. Do not submit the prepared `RINLYN Test AI` signup or continue staging OA provisioning. No completed OA creation has been observed. Staging has no LINE credentials configured.

An inactive, secret-free n8n workflow is prepared at ignored `artifacts/workspaces/n8n/rinlyn-ai-staging.json`. It uses only Staging `/api/ai/line` and `/api/ai/reply`, with webhook path `rinlyn-secretary-ai-staging`.

Imported and saved as **RINLYN AI — Staging Multi-Space**, workflow `V2FCdPAQLpmvTOEK`, without publishing. Selected the existing `RINLYN AI — OpenRouter` credential; no secret values were viewed or copied. The import did not preserve workflow settings: explicitly set failed/successful/manual/progress execution retention to **Do not save** and timeout to 90 seconds, then verified the save confirmation. Timezone shows the Asia/Bangkok default. Do not edit or publish the production workflow as part of this setup.

Record actual OA IDs, workflow ID, deployment, test results and rollback steps after setup. A server fixture, signed synthetic event, or browser emulation must not be described as an actual Google/LINE/device test.

## Secretary test data

- Created through the real Secretary browser session: task `reczK7Y9arfmc7wCw` / HVR-00017, `[SPACE B ROLE TEST] ติดตามเบี้ยลูกค้าสมมติ`, assigned to Agent A. Synthetic case name, due 22 November 2026, status In Progress and priority High.
- Public marker `[SPACE B PUBLIC TEST]`, internal marker `[SPACE B INTERNAL TEST]`, and private follow-up `[SPACE B FOLLOWUP TEST]` are deliberate permission-test fixtures. Live `detail()` checks confirm Agent A receives the public update but no internal update or follow-up rows.
- Secretary created `[SPACE B TEST] แบบประกัน — ร่างเลขา` as an unpublished Google Drive link-only draft using the owner's earlier sample URL. It must stay unpublished until an Admin review is intentionally tested.
- Agent A subsequently logged in and verified the same task in the real browser: public updates visible; internal note/private follow-up text absent; no task edit/status controls. Next-follow-up date remains part of the public task summary, while follow-up detail rows remain private.
- Agent A created task `recUDadHZvW7aafHX` / HVR-00018, `[SPACE B AGENT TEST] ขอเลขาติดตามเคสสมมติ`, through their browser session. The form offers no owner selector and the saved owner is Agent A. Original RINLYN shows their existing 7 tasks and rejects this Space B task URL.
- Evidence: `artifacts/vercel/workspaces-secretary-task-acceptance.json`, `artifacts/workspaces/secretary-space-b-task.jpg`, `secretary-document-draft.jpg`, `agent-a-own-task.jpg` and `agent-a-created-task.jpg`.

## Agent B negative checks

The real `sidatacheckup@gmail.com` browser session lists only RINLYN with the Agent role and 3 own tasks. Task `recKfobW7qYwhJOsP` opens. Agent A task `recGsuKkzD5RmLCOw` returns a permission error. A direct `/spaces/open?space=e023892a-33a9-485d-8e5a-b352eb0e480f&next=...` link shows “คุณไม่มีสิทธิ์เปิด Space ของลิงก์นี้” without listing or opening its tasks. Evidence: `agent-b-space-denied.jpg` and `agent-b-spaces.jpg` under ignored `artifacts/workspaces/`.

## Owner's deferred Production LINE checklist

Perform after the separately planned Production backup/bootstrap/deployment, using synthetic cases and authorized accounts. This is a checklist, not a record of completed testing.

1. Confirm existing RINLYN LINE bindings still work; link the same test user separately inside a second authorized Space. Check the displayed LINE identity before confirming.
2. Use **ใช้ Space นี้ใน LINE AI** in Space A, ask for a daily summary and a known case, and compare with the website. Switch to Space B explicitly and repeat. Switching the website alone must not silently change LINE context.
3. Ask about a task/document that exists only in the other Space. Verify the reply contains no foreign records or internal Secretary data. Follow-up questions and memory must stay within the chosen Space.
4. Prepare a task draft in A, switch LINE to B and attempt the old confirmation: no task may be created in either Space from that stale confirmation. Create a fresh confirmed draft in B and verify exactly one task, correct owner, and a Space-specific link.
5. Test new-task Secretary and completed-task Agent notifications with explicit opt-in. Confirm Space label, authorized recipient, link target and no duplicate notification on retry. Keep pending checklist items blocking completion as usual.
6. With an Admin present, temporarily disable a test membership, verify its LINE requests cannot read or create tasks, then restore the original membership. Do not use a sole Admin for this test.
7. If any reply or notification exposes another Space, stop the affected AI/notification feature and investigate before inviting more users. Preserve the encrypted workspace key and backups; do not roll back by simply setting `WORKSPACES_ENABLED=false` after bootstrap.
