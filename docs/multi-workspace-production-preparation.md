# เตรียม Production สำหรับหลาย Space

ตรวจวันที่ 21 พฤศจิกายน 2569 ตามคำขอสำรองข้อมูลและเตรียม Control Base เท่านั้น ยังไม่ apply migration 013, bootstrap, เปลี่ยน environment ของ Vercel หรือ deploy Production

## ระบบเดิมและข้อมูลสำรอง

Production ยังใช้ deployment `dpl_EkvvhmQC8TX3dVaaVT7rFsdZjtoi` และ business Base `appDS1Ji5cqIohPq3` Neon มี 27 ตารางใน `public`, `task_writes=true`, `jobs=false`; operation journal 174 รายการเสร็จแล้ว ไม่มี pending/running/review ณ preflight

| ส่วน | ผลตรวจ |
| --- | --- |
| Neon | pg_dump จาก read-only consistent snapshot; AES-256-GCM; กู้คืนใน PostgreSQL container ที่ไม่มี network/port ผ่านทั้ง 27 ตารางและ constraints |
| Airtable records | Users 7, Tasks 27, Task Updates 130, Follow-ups 10, Notifications 63; อ่าน API 6 ครั้ง; เข้ารหัสและทดสอบถอดรหัส/ปฏิเสธไฟล์ที่ถูกแก้ไขผ่าน |
| Airtable native copy | [RINLYN — Before Multi-Space 2026-11-21](https://airtable.com/appM8Qku7tiy0JfQO); เปิด Duplicate records/comments ตรวจจำนวนทั้ง 5 ตารางตรงกับ export; Table 1 ว่าง; ไม่มี automation ที่ตั้งค่าไว้ |
| Configuration | สำรองค่าที่ pull จาก Vercel และ secrets จากไฟล์ operator เดิมแบบเข้ารหัส แต่ยังไม่ครบตามข้อจำกัดด้านล่าง |

Neon run `d4614c8f-fd9c-4b56-afd2-570eb20b98e9` อยู่ใน `artifacts/vercel/workspace-production-backups/` ต้นฉบับ dump เก็บครบ; เฉพาะ SQL สำหรับซ้อม restore ตัด Neon `pg_attver` 36 บรรทัดที่ stock PostgreSQL ไม่รองรับ เทียบแถวด้วย SHA-256 และ collation C; ปิดและนำ container ทดสอบออกแล้ว

Airtable export run `airtable-0adc4472-76a6-45da-a958-738b2aec3860` เก็บ linked record IDs และ URL ไม่ดาวน์โหลดไฟล์แนบ ส่วน schema เก็บใน native copy; native duplication ไม่เก็บ revision history การอ่าน Airtable กับ snapshot Neon เป็นคนละเวลา จึง **ไม่ใช่ชุดสำรองสุดท้ายสำหรับ cutover** ต้องสำรองซ้ำเมื่อพักการเขียนจริง

## Control Base ใหม่

[RINLYN Control — Production](https://airtable.com/appNNv2JEkIiBJU6x) สร้างใน My First Workspace จาก schema ของ Staging โดยปิด Duplicate records ไม่มีสมาชิกหรือ Space ทดสอบติดมา

| ตาราง | ID | Records |
| --- | --- | --- |
| Users | `tblfQMvyea3Pp6C9j` | 0 |
| Workspaces | `tbl5F8uxP3718zQj5` | 0 |
| Workspace Members | `tblGV58yM2ybjMTsc` | 0 |

ตรวจ read-only ผ่าน Scripting และ local assertions: field types, role choices, `RECORD_ID()`, Created At, Last Login Asia/Bangkok, single links และ Lookup ไป Record ID ถูกต้อง มี Table 1 ว่างที่ไม่ใช้ในแอป คงไว้โดยไม่แก้ schema ต้นทาง

สร้าง `WORKSPACE_ENCRYPTION_KEY` แยกจาก Staging ใน ignored private configuration แล้ว ยังไม่ใส่ Vercel และยังไม่เปิด `WORKSPACES_ENABLED` หลังเจ้าของยืนยัน ณ ขั้นสร้าง credential ได้สร้าง PAT **RINLYN Control — Production Runtime** ให้ `data.records:read/write` เฉพาะ Base ใหม่นี้ เก็บใน private file ที่ Git ignore และสำรอง AES-256-GCM พร้อมทดสอบถอดรหัสและปฏิเสธไฟล์ที่ถูกแก้ไขแล้ว

ตรวจ PAT จริงผ่านการอ่าน 3 ตารางว่างและ filter formulas รวม 6 ครั้ง; การเข้าถึง business Base Production, Control/Business Base Staging, Space B และ API อ่าน schema ถูกปฏิเสธ 403 ทั้งหมด ไม่สร้าง record เพื่อทดสอบ write; สิทธิ์ write ตรวจจากหน้าตั้งค่า PAT ไม่ใช่ผลทดสอบเขียนจริง ยังไม่มีการเพิ่มสมาชิกหรือเปลี่ยนค่าบน hosting

ชุดสำรองล่าสุดที่รวม PAT คือ `artifacts/vercel/workspace-production-backups/rinlyn-production-preparation-2026-11-21-with-control-pat.zip` ใช้กุญแจสำรองแยกไฟล์เดิม มี manifest และ `archive-helper.mjs` สำหรับตรวจ hash/ถอดรหัสโดยไม่พิมพ์ secrets ชุด ZIP ก่อนหน้าคงไว้แต่ไม่มี PAT ใหม่นี้

## ข้อจำกัดและขั้นถัดไป

- Vercel ไม่ export sensitive values; secrets ที่สำรองจากไฟล์ operator ไม่ถือว่าพิสูจน์ว่าเท่ากับ hosting ทุกตัว DB connection และ Airtable PAT ผ่านการอ่านจริง ส่วน OAuth/LINE/cron/auth ไม่ได้ทดสอบเปรียบเทียบ secret
- ยังขาด `AI_LINE_CHANNEL_ACCESS_TOKEN` และ `AI_LINE_CHANNEL_SECRET` ในชุดสำรอง configuration ต้องเก็บจาก LINE Developers ของ OA เดิมผ่านช่องทางส่วนตัวก่อนถือว่ากู้คืนทั้งระบบได้ ห้าม regenerate หรือใส่ค่าที่ขาดทับ Vercel เพื่อให้ export ดูครบ
- เก็บกุญแจ `artifacts/vercel/workspace-production-backup-key.private.json` แยกจาก archive และทำสำเนานอกเครื่องผ่านช่องทางที่เจ้าของอนุมัติ รอบนี้ยังไม่ upload backup ออกนอกเครื่อง; native Airtable copy อยู่ในบัญชีเดิม
- PAT ของ Control Base พร้อมแล้ว; ตั้งค่า Vercel Production และเปิดใช้เฉพาะในขั้น cutover ที่แยกจากการเตรียมครั้งนี้
- ก่อน cutover: ทบทวน [runbook หลาย Space](multi-workspace.md), สำรองคู่กันใหม่ภายใต้ maintenance, migration/bootstrap ผู้ใช้เดิมและ Owner, deploy แล้วทดสอบ Google Login/สิทธิ์/งานเดิมก่อนเปิด writes
- LINE จริงหลาย Space ยังไม่ได้ทดสอบ เจ้าของเลือกทดสอบเองบน Production ตาม [checklist](multi-workspace-acceptance.md#owners-deferred-production-line-checklist) ห้ามบันทึกว่า LINE ผ่านแล้ว
- หลัง bootstrap ห้าม rollback ด้วยการปิด flag หรือกลับ release เดิมอย่างเดียว ต้องกู้ Neon + Control Base + environment ที่เข้าคู่กัน และ reconcile งานที่เพิ่มหลัง backup

หลักฐานและไฟล์ส่วนตัวทั้งหมดอยู่ใต้ ignored `artifacts/` ไม่ใส่ข้อมูลลูกค้า, Token หรือกุญแจใน Git
