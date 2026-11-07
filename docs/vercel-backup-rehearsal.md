# ซ้อมสำรองและกู้ฐานข้อมูล Neon staging

วันที่ 7 พฤศจิกายน 2026 · ผ่านรอบ `434c69c1-7393-4de3-91c2-756e4cadee5b` · ยังไม่ใช่ backup policy หรือการกู้ production

## เตรียมและรัน

ใช้ Node.js 24, Docker Desktop และ image `postgres:18.6` ที่ติดตั้งแล้ว เครื่องมือใช้ `--pull=never` ไม่ดาวน์โหลด image เอง รันจาก `web/` โดยกำหนดค่าผ่าน environment ของ shell/secret manager:

- `APP_ENV=staging`, `VERCEL_ENV=preview`, `AIRTABLE_BASE_ID=appoQzvQwGShlq4OJ`
- `DATABASE_URL` และ `DATABASE_MIGRATION_URL` ของ Neon staging; migration URL ต้องเป็น direct endpoint และ `sslmode=verify-full`
- `HVR_BACKUP_ENCRYPTION_KEY`: random 32 bytes ในรูป hex 64 ตัว เก็บแยกจาก archive ใน secret manager ห้าม commit หรือส่งในแชต

Environment ที่ส่งให้ process มีลำดับก่อน `.env.local`; ไม่ต้องแก้หรือทับ credentials ของ localhost จากนั้น:

```powershell
npm run rehearse:backup -- --confirm-test-base=appoQzvQwGShlq4OJ
```

ก่อนรัน DB ต้องผูก staging/test Base ตรงกัน, writes/jobs ปิด, ไม่มี pending/running/review หรือ schema ทดสอบเก่าค้าง หากไม่ครบเครื่องมือหยุดก่อนสร้าง fixture

## สิ่งที่คำสั่งตรวจ

สร้าง schema สุ่มที่มี owner marker และข้อมูลสมมติสำหรับ session, OAuth, journal, recovery และ resource reservation โดยไม่เพิ่ม records ในตาราง `public` หรือเรียก Airtable ใช้ exported snapshot เดียวกันสำหรับ row digests และ `pg_dump` ของ public/fixture

เข้ารหัส archive ด้วย AES-256-GCM ก่อนเขียนลง disk ตรวจว่าการแก้ ciphertext ทำให้ถอดรหัสไม่ผ่าน แล้ว restore จาก archive ที่อ่านกลับลง PostgreSQL ใน container เฉพาะรอบ มี `--network=none` และไม่เปิด port ข้อมูล dump ที่ถอดรหัสส่งผ่าน stdin ในหน่วยความจำ

เทียบข้อมูล 20 ตารางและ constraints สอง schema ตรวจ review/reservation และ flags หลัง restore แล้วล้างเฉพาะ schema/container ที่ชื่อและ owner marker ตรงรอบนี้ รายงานจะผ่านเมื่อ verification และ cleanup ครบ หลักฐานอยู่ `artifacts/vercel/backups/<run-id>/report.json` และ `operational.dump.enc` ซึ่ง Git ignore

## ผลและข้อจำกัด

รอบที่ผ่านใช้ PostgreSQL 18.6, TLS `verify-full` และ CA bundle จาก Node default trust store แบบ mount read-only; image ขั้นต่ำไม่มี system CA bundle จึงไม่ใช้ `sslmode=require` เพื่อข้ามปัญหา รอ TCP readiness เพื่อไม่จับ temporary initialization server

ตรวจ Neon direct/pooled หลังล้างแล้ว: migrations 2, binding ถูกต้อง, writes/jobs ปิด และ operational tables ใน public ว่าง รอบล้มเหลวก่อนหน้าเก็บ report ไว้ ไม่ถือว่าผ่าน

การซ้อมนี้ไม่ทดสอบกู้ลง cloud ใหม่, การเก็บสำรองนอกเครื่อง, retention, key recovery หรือสำรอง Airtable ต้องกำหนดและซ้อมส่วนเหล่านั้นก่อน production ตาม [แผน Deploy](vercel-deployment-plan.md) หากคำสั่งล้มเหลวให้ตรวจ `failedPhase`/`cleanupFailed` และทรัพยากรรอบเดิมก่อนรันใหม่ ห้ามลบ schema อื่นหรือ replay งานที่ยังไม่พิสูจน์ผล
