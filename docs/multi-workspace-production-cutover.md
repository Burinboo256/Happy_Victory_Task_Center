# แผนเปิดหลาย Space บน Production

วันที่ 21 พฤศจิกายน 2569 เจ้าของอนุญาตให้วางแผนและดำเนินการจนขึ้น Production การยืนยัน Google Login ต้องทำโดยเจ้าของเอง ส่วน LINE บนโทรศัพท์หลาย Space ยังคงเป็นรายการที่เจ้าของเลือกทดสอบหลังเปิดระบบ ไม่ถือว่าผ่านล่วงหน้า

## ลำดับดำเนินการ

1. ตรวจ source, CI, Production deployment และ Control Base ให้ตรง [รายงานเตรียมระบบ](multi-workspace-production-preparation.md) เก็บค่าลับเดิมโดยไม่ regenerate และไม่แทน sensitive values ด้วย placeholder จาก Vercel export
2. เพิ่ม `MAINTENANCE_MODE` ที่ Next.js Proxy ให้คืน 503/no-store/Retry-After ก่อนเรียกบริการใด รวม Login, callback, API, server actions และ LINE endpoints ยกเว้น GET/HEAD health, static chunks และ favicon ทดสอบเปิด/ปิดโหมดและ CI ให้ผ่านก่อนใช้
3. เตรียม Production release แบบ maintenance โดยยังไม่ bootstrap และยังตั้ง `WORKSPACES_ENABLED=false` ใช้ secret เดิมของ hosting เพิ่มเฉพาะ Control Base configuration และกุญแจใหม่ตามที่อนุญาต ไม่แก้ Preview/staging
4. เมื่อ maintenance deployment READY และ alias ถูกต้อง ตรวจ URL เว็บ/Login/webhooks คืน 503 แล้วปิด `hvr_runtime.task_writes` และคง jobs=false รอคำขอที่เริ่มก่อนหน้าให้จบ ตรวจ operation journal และข้อมูลที่อาจเปลี่ยนจาก webhook/Login ก่อน backup
5. สำรอง Neon/Airtable/Control configuration ใหม่ขณะพักระบบ ทดสอบถอดรหัสและ local restore พร้อมบันทึกจุดกู้คืน นี่คือชุด cutover; ชุด preparation ก่อนหน้าเป็นเพียงสำรองก่อนเตรียมงาน
6. รัน migration 013 ผ่านเครื่องมือที่ตรวจ environment/base binding แล้ว จากนั้น dry-run bootstrap และตรวจรายชื่อเดิม/อีเมลซ้ำ/Owner ก่อน `--apply` เลือก Admin เดิม `mydreamyoudream@gmail.com` เป็น System Owner
7. ตรวจ Users/Workspace Members ทั้งหมด, roles/Active, identity mappings, RINLYN default Space, LINE routing และเทียบ tasks/updates/follow-ups/notifications/workflows/documents กับ baseline ห้ามเปลี่ยน linked record IDs ของงานเดิม
8. ตั้ง `WORKSPACES_ENABLED=true` และเตรียม release เปิดเว็บโดยปิด maintenance แต่ยังปิด runtime writes ตรวจ health, anonymous authentication boundaries, OAuth callback configuration และหน้า Login/เลือก Space
9. เจ้าของ Login Google ด้วยตนเองเพื่อตรวจ RINLYN, Owner และสมาชิก หากต้องรอ Login ให้แจ้งสถานะตรง ๆ งานยังพักการเขียน ไม่ส่ง token/session ในแชต
10. เมื่อข้อสำคัญผ่าน เปิด runtime writes ตรวจสถานะและเก็บหลักฐาน ยังคง jobs=false ตามเดิม ไม่เปลี่ยน webhook/OA/n8n ถ้า endpoint เดิมรองรับรุ่นใหม่อยู่แล้ว
11. บันทึก deployment/commit/migrations/จำนวนข้อมูล/ผลทดสอบ และสิ่งที่รอเจ้าของทดสอบไว้ใน runbook; สำรองหลัง bootstrap เพิ่มอีกชุด รวม Control records และกุญแจที่ต้องใช้กู้คืน

## จุดหยุดและการกู้คืน

- ก่อน bootstrap: หาก preflight, CI หรือ backup ไม่ผ่าน ให้คงระบบเดิมหรือกลับ release maintenance-off เดิม ก่อนเปิด writes อีกครั้งต้องตรวจ state จริง
- หลัง bootstrap: ห้ามปิด `WORKSPACES_ENABLED` หรือ rollback เป็นโค้ด legacy อย่างเดียว ให้เปิด maintenance และคง writes ปิดก่อนตรวจปัญหา เลือกแก้รุ่นหลาย Space หรือกู้ Neon + Control Base + configuration ที่เข้าคู่กันจาก cutover backup และ reconcile การเขียนภายหลัง
- แยกสถานะ “deployment READY”, “ตรวจ service ผ่าน”, “Google Login จริงผ่าน” และ “LINE บนอุปกรณ์จริงผ่าน” ไม่ใช้ผลแทนกัน
- `MAINTENANCE_MODE` เป็นสวิตช์ของแต่ละ deployment ไม่ใช่สวิตช์ทันทีทั้งประวัติ URL ตรวจช่องทางเว็บ/LINE ใช้ production alias และจัดการคำขอเก่าที่ค้างก่อนย้าย ข้อมูลสำรองแต่ละบริการไม่ได้เป็น transaction เดียวกัน

## บันทึกผล

วันที่ 22 พฤศจิกายน 2569: Owner Login Google จริงผ่าน เปิด Space RINLYN และเห็นงานเดิมครบ 27 รายการแล้ว เปิดการส่งและแก้ไขงานกลับมา โดย runtime `task_writes=true`, `jobs=false` ตามเดิม

- Commit `07d6a296749525807165086f0b1f22e2afcba0e6` อยู่บน main/staging; [CI 44876283297](https://github.com/Burinboo256/Happy_Victory_Task_Center/actions/runs/44876283297) ผ่านครบ รวม lint/typecheck/unit/integration/PostgreSQL/build/E2E/load
- Maintenance deployment `dpl_AEfCjjhZwUk7PhVMakttcBQL3CpY` ตรวจ 503/no-store ครอบคลุม Login/callback/API/webhooks แล้ว ปิด runtime writes และรอคำขอเดิมก่อนสำรอง
- Release หลาย Space `dpl_BMCCbxVxKzofULeTd3Vww6NRhGR4` READY; Production alias ตรง commit ข้างต้น ตั้ง `WORKSPACES_ENABLED=true`, `MAINTENANCE_MODE=false`
- Migration 013 ผ่าน มี Neon public 35 ตาราง; Control Base `appNNv2JEkIiBJU6x` มี Users 7, Workspaces 1, Workspace Members 7; Owner ใช้ Admin เดิม
- Space RINLYN ใช้ Base `appDS1Ji5cqIohPq3` และ schema public เดิม ยืนยัน Users 7 / Tasks 27 / Updates 130 / Follow-ups 10 / Notifications 63 ไม่เปลี่ยนจากสำรอง ทั้ง record IDs และ fields
- เทียบ hash ข้อมูล Neon ที่ต้องคงเดิมแล้ว รวม workflows, documents/favorites, LINE accounts/settings/deliveries, AI memory และ operation journal การเปลี่ยนที่ตั้งใจคือ migrations, identity/registration mappings, session/OAuth reset และ rate-limit bookkeeping
- ตรวจ health/Login 200; API Space ปฏิเสธผู้ไม่มี session ด้วย 401; OAuth client/callback ตรง Production; webhook ของ OA `@672vhuss` และ `@688rmrty` รับ signed empty events ได้ 200 ไม่ส่งข้อความทดสอบ ไม่เปลี่ยน webhook หรือตัว workflow n8n
- ตรวจ Production service layer ผ่านทั้ง 7 บัญชี: Admin 1, Secretary 3, Agent ที่ Active 1 และ pending 2 บัญชียังคงถูกปฏิเสธ การขอ Space ที่ไม่มีอยู่ถูกปฏิเสธทุกบัญชี; POST งาน/Space ที่ไม่มี session คืน 401 การทดสอบนี้ไม่ใช่ browser Login จริง
- Owner Login หลังย้ายผ่าน: ตรวจ session ที่ยังไม่หมดอายุและ Google Subject ตรง Control User ที่ Active/System Role=Owner; หน้า Space แสดง Admin ของ RINLYN และสิทธิ์สร้าง Space ใหม่ เข้า Dashboard ได้ งาน 27 รายการครบ
- เปิด runtime writes วันที่ 22 พฤศจิกายน 2569 หลังตรวจ Base/Control fingerprint/catalog และไม่มี unfinished operations; คง jobs=false ไม่เปลี่ยน OA/n8n
- ตรวจหน้า `/tasks/new` หลังเปิด writes แล้ว: ช่องกรอกและปุ่มส่งงานพร้อมใช้งาน ไม่มีข้อความพักการบันทึก ไม่สร้างงานสมมติหรือส่ง LINE แจ้งทีม Production
- ยังรอเจ้าของทดสอบ LINE หลาย Space บนอุปกรณ์จริงตามที่เลือกไว้ ไม่ใช้ผล signed empty events แทนการถาม AI/ส่งงาน/รับแจ้งเตือนจริง

### สำรองและกู้คืน

- ก่อน bootstrap: Neon run `a625460e-17da-4572-bace-c7d30219a2f4` restore แยกเครือข่ายผ่าน 27 ตารางและ constraints; Airtable export `airtable-0cbc935c-5c0c-4d47-8c06-7e3403312276` ถอดรหัส/ตรวจ tamper ผ่าน
- หลัง bootstrap ก่อนเปิด writes: Neon run `80ccbe68-8484-43e2-9fe1-cfed45f310c2` restore ผ่าน 35 ตารางและ constraints; สำรอง Control records และ config ที่เปิดหลาย Space เพิ่มแล้ว
- ชุดรวมอยู่ใน ignored `artifacts/vercel/workspace-production-backups/rinlyn-production-cutover-2026-11-21.zip`; ตรวจ manifest 8 ไฟล์และ authenticated archives 5 ชุดผ่าน กุญแจแยกอยู่ `artifacts/vercel/workspace-production-backup-key.private.json` ไม่รวมใน ZIP และยังไม่ได้อัปโหลด offsite
- ชุด cutover นี้มี config/LINE AI credentials ครบเพิ่มเติมจากชุด preparation เก่า ไม่ได้แก้ย้อนหลังให้ archive preparation กลายเป็นชุดครบ
- Native Airtable backup `appM8Qku7tiy0JfQO` ใช้อ้างอิง schema; ใช้ record export รอบพักระบบสำหรับข้อมูล ณ cutover การคืนข้อมูลต้องรักษาหรือ remap record IDs ให้สัมพันธ์กับ Neon
- เก็บ original pg_dump โดยไม่แก้; การซ้อมบน PostgreSQL ปกติถอดเฉพาะ Neon `pg_attver` column storage statements ใน SQL ชั่วคราว ไม่ใช่การลบข้อมูลหรือ constraints
- Snapshot หลัง bootstrap ยังมี writes=false ต้องประเมินข้อมูลที่เปลี่ยนภายหลังและตรวจ binding ก่อนเปิด writes หลัง restore
