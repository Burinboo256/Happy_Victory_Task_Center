# แจ้งงานเข้าใหม่ให้เลขาผ่าน LINE OA

ระบบ Vercel ส่งข้อความส่วนตัวจาก OA หลังบันทึกงานและประวัติสำเร็จ ใช้กับงานที่ส่งผ่านเว็บเท่านั้น ไม่ตรวจจับงานที่สร้างตรงใน Airtable และไม่ส่งงานเก่าย้อนหลัง

## สำหรับเลขา

1. เพิ่ม OA **@688rmrty (Happy Rinlyn Task)** เป็นเพื่อน
2. Login เว็บด้วย **tarn.allianz@gmail.com** → **ทีมของเรา** → **แจ้งงานใหม่ผ่าน LINE**
3. กด **สร้างรหัสเชื่อม LINE** แล้วส่งข้อความ `HVR ...` ที่แสดงในแชตส่วนตัวของ OA ภายใน 10 นาที
4. กลับเว็บ กด **อัปเดตสถานะ LINE** ตรวจชื่อบัญชีแล้วกด **ยืนยันบัญชี LINE ของฉัน**
5. ให้ Admin เลือกผู้รับและเปิดแจ้งเตือน จากนั้นส่งงานใหม่ชื่อ `[LINE TEST] ทดสอบแจ้งเลขา` ตรวจข้อความและปุ่มเปิดงาน

ใช้รหัสกับบัญชีตัวเองเท่านั้น การเชื่อมใหม่ต้องให้ Admin อนุมัติใหม่ บล็อก OA จะปิดผู้รับ; ยกเลิกบล็อกแล้วต้องเชื่อม/อนุมัติใหม่

## สำหรับ Admin

หน้า **ทีมของเรา** แสดงบัญชี LINE ที่เลขายืนยันแล้ว เลือกเฉพาะเลขาที่ต้องรับงาน แล้วกด **เปิดแจ้งเตือนงานใหม่** เลขาที่เลือกทุกคนจะรับงานใหม่ทุกประเภท หากส่งไม่สำเร็จให้ตรวจสถานะและใช้ **ลองส่งคิวที่พร้อมอีกครั้ง** หลังแก้สาเหตุ

สถานะ **LINE รับคำขอแล้ว** หมายถึง API ยอมรับ ไม่ยืนยันว่าได้รับหรืออ่านแล้ว ปุ่มเปิดงานต้อง Login และตรวจสิทธิ์ตามปกติ ข้อความมีชื่อเรื่อง ประเภท ความเร่งด่วน ผู้ส่งและกำหนดส่ง; ไม่ส่งรายละเอียด เอกสาร หรือบันทึกภายใน

## การติดตั้ง

- Apply `005_line_notifications.sql` ก่อน deploy; สำรอง Neon และทดสอบ restore ก่อนเปลี่ยน Production
- ตั้งเฉพาะ Vercel **Production**: `LINE_OA_ID`, `LINE_BOT_USER_ID`, `LINE_CHANNEL_SECRET`, `LINE_CHANNEL_ACCESS_TOKEN`, `CRON_SECRET` (สุ่มอย่างน้อย 32 ตัวอักษร), `ENABLE_LINE_NOTIFICATIONS=true` เก็บ secret เฉพาะ server/ไฟล์ที่ Git ignore
- ใช้ `GET https://api.line.me/v2/bot/info` ตรวจว่า token ตรง OA และนำ `userId` มาใช้เป็น `LINE_BOT_USER_ID`
- ตั้ง webhook `https://happy-victory-task-center.vercel.app/api/line/webhook` แล้ว Verify / เปิด Use webhook และ redelivery เมื่อพร้อม ผู้ใช้อนุญาตย้ายจาก n8n เดิม; เก็บ URL เดิมในไฟล์ส่วนตัวเพื่อย้อนกลับ
- ระบบใหม่รับรหัสเชื่อมและเหตุการณ์บล็อก OA; ไม่แทนความสามารถสนทนา/ตอบคำถามของ n8n เดิม
- Flags jobs/email เดิมไม่ต้องเปิด ตาราง Airtable ไม่ต้องเปลี่ยน และฟิลด์ LINE เดิมใน Airtable ไม่ได้เป็นแหล่งตั้งค่าของรุ่น Vercel
- Preview/staging ไม่อนุญาตส่งจริง ใช้ mock transport กับฐานข้อมูลแยกสำหรับ acceptance

## การส่งซ้ำและข้อจำกัด

Outbox ถูกสร้างใน transaction เดียวกับ operation ที่เสร็จสมบูรณ์ มี unique operation/recipient และ worker claim กันส่งพร้อมกัน การส่งครั้งแรกทำผ่าน Next.js `after()` หลัง response; สำรองด้วยการใช้งานเว็บของผู้จัดการ ปุ่ม Admin และ cron วันละครั้ง (08:00–08:59 กรุงเทพฯ ตามข้อจำกัด Hobby)

คิวแต่ละรอบทำสูงสุด 3 รายการ/ประมาณ 25 วินาที มี exponential backoff เมื่อเครือข่าย/LINE ขัดข้อง จึงไม่รับประกันการลองใหม่ทันทีเมื่อไม่มีคนใช้เว็บหรือมีคิวสะสม หากต้องการ SLA ส่งซ้ำถี่แม้เว็บไม่มีผู้ใช้ ต้องเพิ่ม scheduler/queue ที่รองรับ

ส่ง `X-Line-Retry-Key` เดิม พร้อมผู้รับและ payload เดิมทุกครั้ง หยุดลองใหม่เมื่อเกิน 23 ชั่วโมงจากการส่งครั้งแรก เพราะ LINE เก็บ retry key 24 ชั่วโมง รายการ **ต้องตรวจสอบ** ไม่สร้าง key ใหม่อัตโนมัติ มิฉะนั้นอาจส่งซ้ำ ห้ามเปลี่ยน accepted กลับเป็น pending

ก่อนส่งแต่ละครั้งตรวจ Active/Role=Secretary จาก Airtable รวมทั้งสถานะผู้รับและระบบใน Neon การปิดระบบหยุดคิวใหม่และการส่งรอบต่อไป แต่ข้อความที่ส่งออกไปแล้วเรียกคืนไม่ได้ ใช้โควตา push ของ OA ตามจำนวนผู้รับ

## ทดสอบและย้อนกลับ

รัน `npm run test:integration`, `npm run test:api`, `npm run test:e2e -- line.spec.ts` และ build ตรวจการลงทะเบียน LINE, CSRF/role, ลายเซ็น, retry/timeout/409, revoke และสี/หน้าจอมือถือ

หยุดส่งด้วยปุ่ม Admin หรือ `ENABLE_LINE_NOTIFICATIONS=false` แล้ว redeploy เก็บตารางคิวไว้เพื่อสอบทาน การ rollback app ไม่ต้องลบ migration หากคืน n8n ให้คืน webhook เดิมด้วย

อ้างอิง: [LINE webhook signature](https://developers.line.biz/en/docs/messaging-api/verify-webhook-signature/), [LINE retry keys](https://developers.line.biz/en/docs/messaging-api/retrying-api-request/), [Vercel Hobby cron](https://vercel.com/docs/cron-jobs/usage-and-pricing)
