# เตรียม backend ของ staging

สถานะ 6 พฤศจิกายน 2026: เจ้าของเลือก **Neon Free สำหรับ staging** แล้ว สร้าง DB และ migrate สำเร็จ ยังไม่ตั้ง Airtable PAT / Google OAuth ของ staging หรือเปิด business writes

## ทรัพยากร

| รายการ | สถานะที่ตรวจแล้ว |
|---|---|
| Vercel project | `happy-victory-task-center` ในทีม `burin`; production branch คง `main` |
| Staging branch | `staging`; ใช้ Vercel Preview / `APP_ENV=staging` ไม่เปลี่ยน config guard ของ main |
| HTTPS origin เป้าหมาย | `https://happy-victory-task-center-git-staging-burin.vercel.app` · ต้องยืนยัน alias หลัง push ก่อนสร้าง OAuth client |
| Neon resource | `happy-victory-staging` / `store_e4OhmTNisXUwUUcW` |
| Neon project | `fragrant-butterfly-75888616` |
| Plan / region | `free_v3` / Free, payment method ไม่จำเป็น / Singapore `sin1` |
| Neon Auth / Realtime | ปิด ใช้ Google OIDC ของแอปตามเดิม |
| PostgreSQL | server version `180006`; migrations 001 / 002 ผ่าน |
| Binding / flags | `staging` กับ test Base `appoQzvQwGShlq4OJ`; DB writes / jobs ปิด |

ใช้ pooled URL สำหรับ runtime และ direct URL สำหรับ migration ตั้ง `sslmode=verify-full` ทั้งคู่ ตรวจ TLSv1.3 / certificate authorized / hostname ตรงที่ client จริงแล้ว ตาราง sessions, OAuth, bindings, operations, resources และ recovery events เริ่มว่าง ไม่มีการคัดลอกจาก local

ตรวจครั้งแรกด้วย `pg_stat_ssl` ของ backend ได้ false จึงยังไม่สรุปผ่าน ต่อมาตรวจ TLS socket ของ client ตามจุดที่เชื่อมจริงและเก็บทั้งสองค่าไว้ ไม่ลดการตรวจ certificate หลักฐาน `artifacts/vercel/staging-db-preflight-backend-only.json`, `staging-db-preflight.json` และ `staging-db-ready.json`

## การผูก secrets

| ตัวแปร | ขอบเขต / สถานะ |
|---|---|
| `DATABASE_URL`, `AUTH_SECRET` | เตรียมใน ignored artifacts; จะตั้งเป็น secret เฉพาะ Preview / branch staging |
| `DATABASE_MIGRATION_URL` | ใช้ CLI ในเครื่องเท่านั้น ไม่ใส่ runtime Vercel |
| `APP_ENV`, `APP_ORIGIN`, Base / Table IDs | ตั้งเฉพาะ Preview / branch staging หลังยืนยัน alias |
| `AIRTABLE_TOKEN` | รอ PAT ของ staging จำกัด test Base นี้ |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | รอ client ของ staging แยกจาก localhost / Apps Script |
| writes / jobs / notifications | flags เริ่ม false ทั้งหมด |

เคยเชื่อม resource กับ Preview ชั่วคราวด้วย prefix `HVR_STAGING_EXPORT` เพื่อส่งออก connection ไปไฟล์ ignored แล้วถอด auto-connection ออกก่อน push staging ข้อมูล runtime จะ pin ไปยัง DB ที่เตรียมไว้ ไม่ให้ integration สลับ DB / journal ตาม Preview deployments ไม่ส่งออกหรือทับ `web/.env.local`

## Migration ก่อนตั้ง OAuth

`npm run db:migrate` ใช้เพียง `APP_ENV`, `AIRTABLE_BASE_ID`, `DATABASE_URL` และ direct `DATABASE_MIGRATION_URL` เมื่อมี ยังตรวจ TLS / environment target / production Base และ checksum / DB binding ตามเดิม ไม่ต้องใส่ OAuth หรือ PAT ปลอมเพื่อเตรียม schema เว็บ runtime ยังคงต้องมี auth configuration ครบจึงเปิด Login

Regression ตรวจ CLI เมื่อ auth fields ว่าง การรันซ้ำไม่ apply migration ซ้ำ และ binding / checksum mismatch rollback; unit tests แยกยืนยันว่า runtime ไม่ยอมผ่านด้วย DB-only config

## งานที่เหลือก่อนรับรอง staging

1. Push branch / ยืนยัน Preview target และ stable alias แล้วตั้ง variables แบบ branch-specific
2. ตั้ง PAT / OAuth client ที่แยกสำหรับ origin นี้ และตรวจ Audience ผู้ทดสอบ
3. ตรวจ Deployment Protection ว่า callback / โทรศัพท์เข้าได้ โดยยังใช้ Google / Users authorization ของแอปเสมอ
4. Redeploy / Login จริง ตรวจ session / Active / ownership / kill switches แล้วเปิด writes เฉพาะ test Base เมื่อตรวจพร้อม
5. ซ้อม recovery / backup-restore / load และ [อุปกรณ์จริง](vercel-device-acceptance.md) ก่อน owner acceptance

ยังไม่เปลี่ยน plan Vercel, production Base, Apps Script หรือ Rich Menu production
