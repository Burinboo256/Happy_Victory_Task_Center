# เตรียม backend ของ staging

สถานะ 8 พฤศจิกายน 2026: Neon Free / migrations / variables 17 ตัวของ Preview พร้อมแล้ว ตั้ง PAT/OAuth แยกของ staging, Login จริงครบ Admin/Secretary/Agent A/B และ workflow ผ่านตามขอบเขตด้านล่าง เปิด writes เฉพาะ staging/test Base; ยังไม่รับรอง release หรือสลับ production

## ทรัพยากร

| รายการ | สถานะที่ตรวจแล้ว |
|---|---|
| Vercel project | `happy-victory-task-center` ในทีม `burin`; production branch คง `main` |
| Staging branch | `staging`; ใช้ Vercel Preview / `APP_ENV=staging` ไม่เปลี่ยน config guard ของ main |
| HTTPS origin | `https://happy-victory-task-center-git-staging-burin.vercel.app` · typography release `bd7e5f7` READY ใน `dpl_GNmYvnK5A7jyZdA59ki4y4nwzU9y`; รอบเปิด writes คือ `dpl_G3zB1BYNGaTXdn1TpaTRfLoj1orR` |
| Neon resource | `happy-victory-staging` / `store_e4OhmTNisXUwUUcW` |
| Neon project | `fragrant-butterfly-75888616` |
| Plan / region | `free_v3` / Free, payment method ไม่จำเป็น / Singapore `sin1` |
| Neon Auth / Realtime | ปิด ใช้ Google OIDC ของแอปตามเดิม |
| PostgreSQL | server version `180006`; migrations 001 / 002 ผ่าน |
| Binding / flags | `staging` กับ test Base `appoQzvQwGShlq4OJ`; config/DB writes เปิดสำหรับ acceptance; jobs ปิด |
| Function region | `sin1` ตรง Neon; ยืนยันจาก Builds ของ deployment ใหม่แล้ว |

ใช้ pooled URL สำหรับ runtime และ direct URL สำหรับ migration ตั้ง `sslmode=verify-full` ทั้งคู่ ตรวจ TLSv1.3 / certificate authorized / hostname ตรงที่ client จริงแล้ว ตาราง sessions, OAuth, bindings, operations, resources และ recovery events เริ่มว่าง ไม่มีการคัดลอกจาก local

ตรวจครั้งแรกด้วย `pg_stat_ssl` ของ backend ได้ false จึงยังไม่สรุปผ่าน ต่อมาตรวจ TLS socket ของ client ตามจุดที่เชื่อมจริงและเก็บทั้งสองค่าไว้ ไม่ลดการตรวจ certificate หลักฐาน `artifacts/vercel/staging-db-preflight-backend-only.json`, `staging-db-preflight.json` และ `staging-db-ready.json`

## การผูก secrets

| ตัวแปร | ขอบเขต / สถานะ |
|---|---|
| `DATABASE_URL`, `AUTH_SECRET` | ตั้งเป็น sensitive เฉพาะ Preview / branch staging แล้ว |
| `DATABASE_MIGRATION_URL` | ใช้ CLI ในเครื่องเท่านั้น ไม่ใส่ runtime Vercel |
| `APP_ENV`, `APP_ORIGIN`, Base / Table IDs | ตั้งเฉพาะ Preview / branch staging แล้ว; ยังไม่มี variables ของ production |
| `AIRTABLE_TOKEN` | sensitive เฉพาะ Preview / staging; PAT ใหม่จำกัด test Base นี้ ตรวจอ่านครบ 5 ตารางแล้ว |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | sensitive เฉพาะ Preview / staging; client ใหม่ “Happy Victory Task Center — Vercel Staging” แยกจาก localhost / Apps Script |
| writes / jobs / notifications | `TASK_WRITES_ENABLED=true` เฉพาะ Preview/staging และ DB switch เปิดแล้ว; jobs / notifications ยังคง false |

เคยเชื่อม resource กับ Preview ชั่วคราวด้วย prefix `HVR_STAGING_EXPORT` เพื่อส่งออก connection ไปไฟล์ ignored แล้วถอด auto-connection ออกก่อน push staging ข้อมูล runtime จะ pin ไปยัง DB ที่เตรียมไว้ ไม่ให้ integration สลับ DB / journal ตาม Preview deployments ไม่ส่งออกหรือทับ `web/.env.local`

## Migration ก่อนตั้ง OAuth

`npm run db:migrate` ใช้เพียง `APP_ENV`, `AIRTABLE_BASE_ID`, `DATABASE_URL` และ direct `DATABASE_MIGRATION_URL` เมื่อมี ยังตรวจ TLS / environment target / production Base และ checksum / DB binding ตามเดิม ไม่ต้องใส่ OAuth หรือ PAT ปลอมเพื่อเตรียม schema เว็บ runtime ยังคงต้องมี auth configuration ครบจึงเปิด Login

Regression ตรวจ CLI เมื่อ auth fields ว่าง การรันซ้ำไม่ apply migration ซ้ำ และ binding / checksum mismatch rollback; unit tests แยกยืนยันว่า runtime ไม่ยอมผ่านด้วย DB-only config

CI ของ commit `08c7e65` ผ่านแล้ว: [run 42213614773](https://github.com/Burinboo256/Happy_Victory_Task_Center/actions/runs/42213614773) รวม unit 26 / integration 15 / PostgreSQL 8 / browser 24 / HTTP API 13 = 86 web tests และ Apps Script 61

## Backup / restore

[ซ้อม Neon staging](vercel-backup-rehearsal.md) ผ่านแล้ว: encrypted archive, snapshot เดียวกัน, restore แยกไม่มี network/port, เทียบ 20 ตารางและ constraints, review/reservation และล้าง fixture ครบ ตรวจ direct/pooled หลังจบแล้ว public operational tables ยังว่างและ flags ปิด ต้องกำหนด offsite storage / retention / key recovery และซ้อม cloud restore ก่อน production

## งานที่เหลือก่อนรับรอง staging

1. ทดสอบ retry/recovery และ concurrency/load บน staging ต่อจาก desktop acceptance ด้านล่าง; ตัวเลข local rehearsal ไม่แทนผล cloud
2. ซ้อม recovery / load บน staging และ [อุปกรณ์จริง](vercel-device-acceptance.md) ก่อน owner acceptance; backup/restore ที่ผ่านเป็น quarantine local ตามขอบเขตด้านบน

## ซ้อมย้อน deployment บน staging

8 พฤศจิกายน 2026 ซ้อมสำเร็จเฉพาะ stable staging alias: `f2eb6a3` (`dpl_5pBjYa1otoVzP5USeJYJzs5umZKe`) → `bd7e5f7` (`dpl_GNmYvnK5A7jyZdA59ki4y4nwzU9y`) → `f2eb6a3` ตรวจทั้งสอง deployment เป็น READY / Preview / branch staging ใน project เดียวกัน ก่อนเริ่ม Neon ผูก test Base ถูกต้อง ไม่มี pending/running/review operations หรือ reservations

ปิด DB task writes และยืนยันปิดแล้วก่อนสลับด้วย `vercel alias set <deployment-url> happy-victory-task-center-git-staging-burin.vercel.app --scope burin` ตรวจ alias ผ่าน API หลังสลับทุกครั้ง ทั้งเวอร์ชันก่อนหน้าและเวอร์ชันคืนค่าตอบ health 200, anonymous bootstrap 401/no-store, Login พร้อม และ Google redirect 303 ใช้ staging client/callback เดิมพร้อม PKCE S256 ไม่ติดตาม redirect เข้า Google

คืน alias เดิมและตรวจ probes ผ่านก่อนเปิด writes คืนเป็น true; jobs คง false ตรวจ alias production ก่อน/ระหว่าง/หลังแล้วไม่เปลี่ยน ไม่ส่ง business mutation หรือเรียก Airtable API หลักฐาน `artifacts/vercel/staging-rollback.json` หากคืน alias ไม่สำเร็จต้องคง writes ปิดไว้และตรวจสถานะจริงก่อนทำต่อ

ขอบเขตนี้พิสูจน์การสลับ routing/config และ maintenance บน staging เท่านั้น ไม่มีการ restore DB, เปลี่ยน schema, ทดสอบ authenticated business workflow หลัง rollback หรือสลับกลับ Apps Script ยังต้องซ้อม production rollback ตาม [runbook](vercel-deployment-plan.md#8-monitoring-และ-rollback) และ Deploy/test maintenance guard ของ Apps Script ก่อน cutover

## คำขอ key ซ้ำบน staging จริง

8 พฤศจิกายน 2026 ทดสอบ HTTPS → Vercel → Neon/Airtable test Base สำเร็จ ใช้ Agent A ที่ Active และ Google Subject ตรงกับ identity binding เดิม ออก session ทดสอบโดยผู้ดูแลอายุ 5 นาทีผ่าน `createSession` แล้วเพิกถอนเฉพาะ session นี้และตรวจว่าไม่มีเหลือ ไม่อ่าน cookie ของ browser หรือแก้ session เดิม ผลนี้ไม่ใช่ Google OAuth acceptance เพิ่มเติม

เริ่ม create งานสมมติ `[STAGING REPLAY TEST]` แล้วอ่าน Neon จนเห็น journal `running` ก่อนส่ง HTTP คำขอที่สองด้วย key/payload เดิม: คำขอที่สองได้ 202/running กับ operation ID เดียวกัน ขณะคำขอแรกได้ 200/completed จากนั้น completed replay ได้ผลเดิม และเปลี่ยน payload ด้วย key เดิมได้ 409/IDEMPOTENCY_CONFLICT ตรวจ Airtable ตาม Request Key/Operation Key พบ task/audit อย่างละ 1, เจ้าของถูกต้อง และไม่มี reservation ค้าง เก็บงานสมมติไว้เป็นหลักฐาน ไม่มีข้อมูลลูกค้าจริง

รอบนี้รวม HTTP 5 คำขอและ direct Airtable verification 3 calls งบ upstream ผ่าน Vercel ประมาณรวมไม่เกิน 18 calls แต่ไม่ได้วัดจำนวนจริงผ่าน Vercel; อย่าใช้ค่า 18 เป็นยอด Usage ที่ยืนยันแล้ว เวลา context 2,192 ms / create 4,430 ms / duplicate-running 1,051 ms / completed replay 680 ms / conflict 377 ms เป็น single sample ต่อขั้นตอน ไม่ใช่ SLA หรือ load acceptance หลักฐาน `artifacts/vercel/staging-replay.json`

ยังไม่ใช่การพิสูจน์ว่า requests อยู่คนละ Function instance, ต่าง key แก้ task เดียวกัน, lost upstream acknowledgement/recovery หรือ 5 ผู้ใช้/250 งานบน cloud การรับรองกรณีเหล่านี้ยังคงค้างและต้องวางงบ API ก่อนซ้อม

## งบและการเข้าถึง staging

เจ้าของเลือกคง Airtable Free สำหรับ staging ตรวจ Usage จริงแล้ว workspace แสดง Team Trial: รวม 903 / 100,000 calls เดือนนี้ โดย test Base ใช้ 872 และ Base ระบบเดิม 31 เมื่อวางงบตาม Free 1,000 จะเหลือ 97 calls จึงพัก bulk/live load และกันสำรองก่อนทดสอบมือถือเฉพาะจุดตาม [งบ API](vercel-load-acceptance.md#งบ-api-ที่ต้องยืนยัน) ตัวเลขนี้เป็น snapshot ไม่ใช่ตัวจำกัดอัตโนมัติ ไม่เปลี่ยน subscription และไม่ลดการตรวจสิทธิ์หรือ cache Active/Role เพื่อประหยัดโควตา

เจ้าของอนุมัติปิด Vercel Authentication ของโปรเจกต์แล้ว ตรวจจากภายนอกไม่มี Vercel session ได้ health 200, configured Login และ Google OAuth 303 ที่ใช้ client/callback ของ staging, PKCE S256 และ HttpOnly cookie; anonymous bootstrap 401 ไม่ส่งข้อมูลผู้ใช้ หลักฐาน `artifacts/vercel/staging-auth-ready.json` ไม่ใช่ผล Login สำเร็จจริง

Callback: `https://happy-victory-task-center-git-staging-burin.vercel.app/api/auth/google/callback` ตรวจ Audience ผู้ทดสอบเดิมครบ 4 บัญชีแล้ว PAT มีเฉพาะ records read/write จากฟอร์มสร้าง (API whoami ของ PAT ไม่คืน scopes) หลักฐานอ่าน 5 ตาราง `artifacts/vercel/staging-pat-ready.json`; ไม่มีการเขียน records ในการตรวจนี้

CI ของ commit `2c0b9bf` ผ่านใน [run 42377195580](https://github.com/Burinboo256/Happy_Victory_Task_Center/actions/runs/42377195580) ก่อน redeploy credentials

## Admin acceptance บน staging

Google Login จริงกลับ `/tasks/new` ได้ UI แสดงสิทธิ์ Admin ตรวจ Users Active/Subject, identity binding และ live session ใน Neon ตรงกัน ขณะ writes ปิดฟอร์มแสดงสถานะอ่านอย่างเดียวและปิดปุ่มส่ง หลังเปิด config/DB switch เฉพาะ staging แล้วฟอร์มเปิดใช้งาน

สร้างงานสมมติ prefix `[STAGING UI TEST]` ผ่าน Chrome/HTTPS ด้วย Admin session จริงให้บัญชี Agent A สำเร็จ ตรวจ task/audit อย่างละ 1 รายการและ creator/owner ถูกต้อง journal `completed` ไม่มี reservation ค้าง หลักฐาน `artifacts/vercel/staging-admin-login.json` และ `staging-ui-create-result.json` ไม่ใช่การรับรอง Secretary/Agent หรือมือถือจริง

## Secretary acceptance บน staging

Google Login จริงสำเร็จด้วย Role Secretary, Active/Subject/session ตรงกัน และตรวจว่า Admin logout เพิกถอน session เดิมแล้ว Secretary ค้นหา/เปิดงานที่ Admin สร้าง เปลี่ยนเป็น In Progress เพิ่มนัดและบันทึกผล Done ผ่านหน้าเว็บจริง

ตรวจ Airtable/Neon: followup 1 รายการ, Assigned To เป็น Secretary, Completed At มีค่า และ Next Follow-up ถูกล้างเมื่อไม่เหลือ Pending ประวัติ status เปิดให้ Agent ส่วนประวัติ followup ทั้งสองรายการเป็น private; operations รวม create/status/followup/resolveFollowup จบ completed 4 รายการ ไม่มี reservations หรือคำขอค้าง มี notification record Pending 1 รายการตาม workflow แต่ dispatch/jobs ยังปิด หลักฐาน `artifacts/vercel/staging-secretary-login.json` และ `staging-secretary-workflow.json` ยังต้องตรวจการซ่อนข้อมูลจาก Agent ผ่านเว็บจริงต่อ

## Agent A acceptance บน staging

Google Login จริงผ่าน ตรวจ Role Agent/Active/session ตรงบัญชี Agent A ค้นหาและเปิดงานที่ Admin สร้างให้ได้ เห็น timeline 2 รายการ (create/status) ไม่เห็นประวัตินัดทั้งสองรายการ ไม่มี manager controls และไม่มีตัวเลือกบันทึกภายใน เปิด URL งาน Agent B โดยตรงแล้วหน้าเว็บปฏิเสธสิทธิ์และไม่แสดงรายละเอียด จากนั้น Back กลับงานตนเองยังอ่านได้ หลักฐาน `artifacts/vercel/staging-agent-a-login.json`, `staging-agent-a-own-view.json` และ `staging-agent-a-ownership.json`

Logout มีขอบเขต session ปัจจุบัน ไม่เพิกถอนทุก browser/profile ของบัญชีเดียวกัน จึงไม่ใช้จำนวน sessions ของบทบาทอื่นเป็นเกณฑ์ว่าปุ่ม Logout ใน browser นี้ทำงานผิด

## Agent B / runtime controls

Agent B Login จริงผ่าน Role/Active/session ถูกต้อง Dashboard มีงานเจ้าของบัญชี 3 รายการ เปิดงานตนเองได้ ไม่มี manager controls เปิด URL งานของ Agent A แล้วถูกปฏิเสธและไม่เห็นรายละเอียด หลักฐาน `artifacts/vercel/staging-agent-b-login.json` และ `staging-agent-b-ownership.json`

ปิด Active ของ Agent B ชั่วคราวบน test Base แล้ว reload session เดิม: เว็บปฏิเสธสิทธิ์และไม่แสดงงาน คืน Active=true แล้ว session เดิมเปิดงานได้โดยไม่ Login ใหม่ เครื่องมือมี automatic restore ภายใน 120 วินาทีและยืนยันคืนค่าแล้ว หลักฐาน `artifacts/vercel/active-revocation/`

ทดสอบ DB write switch ขณะ config ceiling=true: off ทำให้ฟอร์ม/ปุ่มส่งงานปิด เมื่อ on และ reload ฟอร์มกลับมาใช้งานได้ ไม่ต้อง redeploy คืน switch เป็น on แล้วสำหรับ device acceptance; jobs/notifications ยังปิด หลักฐาน `artifacts/vercel/staging-write-switch-off.json` และ `staging-write-switch-on.json` ผล UI นี้ไม่แทนการทดสอบ forged HTTP mutation ระหว่าง maintenance

## ขนาดตัวอักษร

เจ้าของขอขยายทั้งมือถือและคอมพิวเตอร์หลังลองมือถือ เพิ่ม base 14→16px, ชื่องาน 12→16px, เนื้อหารายละเอียด/timeline เป็น 15px, labels 14px, form controls 16px และข้อความประกอบส่วนใหญ่ 12–14px คงขนาดไอคอน/ภาพตกแต่ง เพิ่มพื้นที่ป้ายสถิติและเรียง footer มือถือให้ข้อความไม่ชนกัน

ตรวจ build/TypeScript/lint, browser regression 24 cases ทั้ง desktop/mobile และ QA 21 ภาพที่ 320/390/1440px ไม่มี horizontal overflow; ภาพฟอร์มและ Dashboard ตรวจด้วยตาแล้ว หลังปรับพื้นที่สถิติ/footer ตรวจ accessibility หน้าหลักซ้ำทั้งสอง viewport หลักฐาน `artifacts/vercel/typography/` เป็นข้อมูลสมมติบนเครื่อง ต้องให้เจ้าของตรวจขนาดตัวหนังสือบนมือถือจริงหลัง deploy อีกครั้ง

CI ของ typography release `bd7e5f7` ผ่านครบใน [run 42431860198](https://github.com/Burinboo256/Happy_Victory_Task_Center/actions/runs/42431860198) รวม unit/integration/PostgreSQL/browser/API/load จำลอง และ Apps Script regression ตรวจ public Login HTML กับ JS/CSS ที่ลิงก์มา 10 resources จาก origin จริง: body 16px, ไม่พบค่า server secrets ที่ตั้งจริง 5 ค่าใน samples, health 200 และ anonymous bootstrap 401 หลักฐาน `artifacts/vercel/staging-typography-ready.json` ไม่ใช่การสแกน server artifacts หรือทุก authenticated response

ยังไม่เปลี่ยน plan Vercel, production Base, Apps Script หรือ Rich Menu production
