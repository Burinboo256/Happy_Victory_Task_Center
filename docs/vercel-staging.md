# เตรียม backend ของ staging

สถานะ 8 พฤศจิกายน 2026: Neon Free / migrations / variables 17 ตัวของ Preview พร้อมแล้ว ตั้ง PAT/OAuth แยกของ staging, Admin Login จริงกลับ `/tasks/new` และสร้างงานสมมติสำเร็จ เปิด writes เฉพาะ staging/test Base แล้ว ยังไม่ผ่าน acceptance ทั้งทีม

## ทรัพยากร

| รายการ | สถานะที่ตรวจแล้ว |
|---|---|
| Vercel project | `happy-victory-task-center` ในทีม `burin`; production branch คง `main` |
| Staging branch | `staging`; ใช้ Vercel Preview / `APP_ENV=staging` ไม่เปลี่ยน config guard ของ main |
| HTTPS origin | `https://happy-victory-task-center-git-staging-burin.vercel.app` · READY Preview `dpl_G3zB1BYNGaTXdn1TpaTRfLoj1orR` จาก commit `2c0b9bf`; รอบแรกที่ตั้ง credentials คือ `dpl_7vS2tTzZPStGcXnfJTD73UP4apAC` |
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

1. ทดสอบ Secretary / Agent A/B จริงต่อจาก Admin; ตรวจ Active / ownership / kill switches และ workflow หลัง deploy
2. ซ้อม recovery / load บน staging และ [อุปกรณ์จริง](vercel-device-acceptance.md) ก่อน owner acceptance; backup/restore ที่ผ่านเป็น quarantine local ตามขอบเขตด้านบน

เจ้าของอนุมัติปิด Vercel Authentication ของโปรเจกต์แล้ว ตรวจจากภายนอกไม่มี Vercel session ได้ health 200, configured Login และ Google OAuth 303 ที่ใช้ client/callback ของ staging, PKCE S256 และ HttpOnly cookie; anonymous bootstrap 401 ไม่ส่งข้อมูลผู้ใช้ หลักฐาน `artifacts/vercel/staging-auth-ready.json` ไม่ใช่ผล Login สำเร็จจริง

Callback: `https://happy-victory-task-center-git-staging-burin.vercel.app/api/auth/google/callback` ตรวจ Audience ผู้ทดสอบเดิมครบ 4 บัญชีแล้ว PAT มีเฉพาะ records read/write จากฟอร์มสร้าง (API whoami ของ PAT ไม่คืน scopes) หลักฐานอ่าน 5 ตาราง `artifacts/vercel/staging-pat-ready.json`; ไม่มีการเขียน records ในการตรวจนี้

CI ของ commit `2c0b9bf` ผ่านใน [run 42377195580](https://github.com/Burinboo256/Happy_Victory_Task_Center/actions/runs/42377195580) ก่อน redeploy credentials

## Admin acceptance บน staging

Google Login จริงกลับ `/tasks/new` ได้ UI แสดงสิทธิ์ Admin ตรวจ Users Active/Subject, identity binding และ live session ใน Neon ตรงกัน ขณะ writes ปิดฟอร์มแสดงสถานะอ่านอย่างเดียวและปิดปุ่มส่ง หลังเปิด config/DB switch เฉพาะ staging แล้วฟอร์มเปิดใช้งาน

สร้างงานสมมติ prefix `[STAGING UI TEST]` ผ่าน Chrome/HTTPS ด้วย Admin session จริงให้บัญชี Agent A สำเร็จ ตรวจ task/audit อย่างละ 1 รายการและ creator/owner ถูกต้อง journal `completed` ไม่มี reservation ค้าง หลักฐาน `artifacts/vercel/staging-admin-login.json` และ `staging-ui-create-result.json` ไม่ใช่การรับรอง Secretary/Agent หรือมือถือจริง

ยังไม่เปลี่ยน plan Vercel, production Base, Apps Script หรือ Rich Menu production
