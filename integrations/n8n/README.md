# RINLYN Secretary LINE AI

ช่องถามงานแบบอ่านอย่างเดียวสำหรับ OA `@672vhuss` ผู้ใช้พิมพ์ถามสถานะหรือสรุปวันนี้เอง ไม่มี Schedule Trigger และไม่เปลี่ยนระบบแจ้งเตือนของ OA เดิม

## โครงสร้าง

LINE → n8n Webhook (raw body) → `/api/ai/line` ตรวจลายเซ็น/บัญชี/สิทธิ์ → OpenRouter เรียบเรียง → `/api/ai/reply` ตรวจสิทธิ์ล่าสุดและส่งกลับด้วย reply token ของเหตุการณ์นั้น

- เชื่อมบัญชีที่ `/notifications` ด้วยรหัส `RINAI` อายุ 10 นาที แล้วกลับมายืนยันชื่อ LINE ในเว็บ
- เก็บการเชื่อม OA ใหม่ในตาราง `hvr_ai_*` แยกจาก OA แจ้งเตือน
- Agent อ่านเฉพาะงานเจ้าของบัญชี Admin/Secretary อ่านตามสิทธิ์เว็บ
- ตรวจ Active, role, binding และความเป็นเจ้าของอีกครั้งก่อนตอบ Agent
- ไม่ส่ง Description, ข้อความอัปเดต, เอกสารแนบ, หมายเหตุ หรือค่าข้อมูลประกอบเคสไปยังโมเดล ชื่องาน/ชื่อเจ้าของ/สถานะ/ความคืบหน้าและวันติดตามยังเป็นส่วนของบริบท
- ยอดรวมคำนวณฝั่งเว็บตามวันประเทศไทย รายการแสดงสูงสุด 60 งาน พร้อม `matched`, `included`, `truncated` ให้โมเดลแจ้งข้อจำกัด ผู้ใช้ระบุรหัส HVR เพื่อหาเคสเฉพาะได้

## ติดตั้ง

1. สำรอง Neon และรัน migration `007_line_ai.sql` ผ่าน `npm run db:migrate` ด้วย environment ที่ถูกต้อง
2. ตั้งค่า Vercel แบบ server-only: `AI_LINE_CHANNEL_SECRET`, `AI_LINE_CHANNEL_ACCESS_TOKEN`, `AI_LINE_OA_ID=@672vhuss`, `AI_LINE_ENABLED=true` แล้ว deploy หากไม่กำหนด `AI_LINE_BOT_USER_ID` ระบบตรวจตัวตน OA ด้วย LINE bot info และ cache 5 นาที
3. สร้างไฟล์ด้วย `node tools/build-n8n-ai.mjs` และนำ `rinlyn-secretary-ai.json` เข้า workflow ว่าง
4. ใน node OpenRouter เลือก Header Auth credential: Name `Authorization`, Value `Bearer <API key>`, Allowed Domains `openrouter.ai` เก็บ key ใน Credentials เท่านั้น
5. ตรวจ Settings: timezone `Asia/Bangkok`, ไม่เก็บ successful/failed/manual execution data และไม่เก็บ execution progress การ import บางเวอร์ชันอาจไม่คัดลอก settings ต้องตรวจใน UI
6. Publish แล้วตั้ง LINE webhook เป็น `https://rinlyn.app.n8n.cloud/webhook/rinlyn-secretary-ai` หลังยืนยันเลิกใช้ webhook เดิมของ OA นี้ เปิด Use webhook และตรวจ Verify
7. เชื่อมบัญชีทดสอบแล้วถาม “สรุปงานวันนี้”, “งานไหนเกินกำหนด”, “สถานะ HVR-00001” เปรียบเทียบกับเว็บ ทดสอบ Agent สองบัญชีและบัญชี inactive

## การตอบและการดูแล

เริ่มด้วย `google/gemini-2.5-flash` ผ่าน OpenRouter เปลี่ยน model ได้ที่ node เดิม โดยคงคำสั่งเรื่องสิทธิ์และขอบเขตข้อมูลไว้ ตั้ง `provider.data_collection=deny` และจำกัดผลตอบกลับ หาก API/เครดิต/โมเดลขัดข้องจะตอบให้ลองใหม่ ไม่สร้างคำตอบจากข้อมูลที่โหลดไม่ครบ

ยอมรับเฉพาะข้อความส่วนตัวที่มีลายเซ็นถูกต้องและเหตุการณ์ภายใน 2 นาที เหตุการณ์ซ้ำไม่เรียกโมเดลซ้ำ Reply ticket เป็นค่าแบบสุ่ม เก็บเฉพาะ hash และใช้ครั้งเดียว ตรวจซ้ำก่อนส่ง ไม่มีสิทธิ์เลือกผู้รับเอง

จำกัด 10 เหตุการณ์/LINE/นาที และ 1,000 เหตุการณ์รวม/วัน เก็บ metadata กันซ้ำไม่เกินประมาณหนึ่งวัน (ล้างเมื่อมี webhook ถัดไป) ล้าง reply token หลังส่งหรือส่งล้มเหลว ไม่เก็บคำถามหรือคำตอบจาก AI ใน Neon หากผลส่งไม่แน่ชัดให้ผู้ใช้ถามใหม่ ไม่ retry node ส่งเอง

หยุดบริการด้วย `AI_LINE_ENABLED=false` และ redeploy หรือ unpublish workflow การ rollback ไม่ต้องลบตาราง และไม่กระทบ OA แจ้งเตือนเดิม

## ตรวจสอบในเครื่อง

`npm test` ที่ root ตรวจโครงสร้าง workflow; ภายใน `web/` ใช้ `npm run build`, `npm test`, `npm run test:integration` และ `npm run test:e2e -- tests/e2e/ai-line.spec.ts tests/e2e/line.spec.ts` การทดสอบใช้ข้อมูลจำลอง ไม่มีข้อความออก LINE จริง
