# Multi-Space Staging Acceptance

Status on 21 November 2026: in progress. Production rollout remains gated on the checks below. Use synthetic cases only; never move the production OA webhooks to Staging.

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
| Secretary permissions | Live services: both Spaces, can read Space B task, no Owner/Admin rights | Google login, edit/status/note/follow-up in browser |
| Agent A permissions | Live services: both Spaces, sees no other Agent's Space B task, no Owner/Admin rights | Google login, create own task, reject foreign task/internal data |
| Agent B outside Space B | Live services deny access | Google login and browser denial |
| Task, document and workflow isolation | Owner browser plus live Airtable/Neon checks passed | Role-based document checks |
| LINE AI linking and explicit Space selection | Isolated integration tests passed | Dedicated staging OA and actual phone interaction |
| AI summaries, task drafts, documents and memory | Isolated integration tests passed | Compare actual LINE replies with each selected Space |
| Old draft/ticket after Space change; revoked membership | Isolated integration tests passed | Actual LINE confirmation rejection and membership restore |
| LINE new-task and completed-task notifications | Existing automated checks passed | Dedicated test OA, opt-in, correct recipient/Space, no duplicate sends |

## Live LINE preparation

The user requested a separate test OA. `RINLYN Test AI` signup is prepared but not yet submitted; its terms require user confirmation. Staging currently has no LINE credentials configured.

An inactive, secret-free n8n workflow is prepared at ignored `artifacts/workspaces/n8n/rinlyn-ai-staging.json`. It uses only Staging `/api/ai/line` and `/api/ai/reply`, with webhook path `rinlyn-secretary-ai-staging`.

Imported and saved as **RINLYN AI — Staging Multi-Space**, workflow `V2FCdPAQLpmvTOEK`, without publishing. Selected the existing `RINLYN AI — OpenRouter` credential; no secret values were viewed or copied. The import did not preserve workflow settings: explicitly set failed/successful/manual/progress execution retention to **Do not save** and timeout to 90 seconds, then verified the save confirmation. Timezone shows the Asia/Bangkok default. Do not edit or publish the production workflow as part of this setup.

Record actual OA IDs, workflow ID, deployment, test results and rollback steps after setup. A server fixture, signed synthetic event, or browser emulation must not be described as an actual Google/LINE/device test.
