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

กำลังดำเนินการ ยังไม่ยืนยันว่า Production เปิดหลาย Space แล้ว ผล CI เดิมของ app `4899bc3` ผ่าน; การเพิ่ม maintenance gate ต้องผ่าน checks ของ commit ใหม่ก่อน deploy
