# AI ช่วยค้นงานผ่าน LINE

## พฤติกรรม

เพิ่มโหมดค้นงานใน OA `@672vhuss` ใช้ n8n HTTP Request/OpenRouter เดิม คำถามเช่น “เคสสมัครตัวแทนที่ยังไม่จบ”, “หางานที่ยังขาดเอกสาร” หรือ “งานของ Agent A ถึงไหน” ให้โมเดลเลือกไม่เกิน 5 IDs จากข้อมูลที่เว็บอนุญาตแล้ว ระบบอ่านข้อมูลล่าสุดอีกครั้งและสร้างชื่อ สถานะ กำหนดส่ง ความคืบหน้า และลิงก์เอง ไม่ส่งข้อความที่โมเดลแต่งเป็นผลค้น

สรุปภาพรวมรายวัน รหัส HVR เฉพาะงาน การถามต่อจากเคสเดิม การส่งงานใหม่ และการค้นแบบฟอร์มคงเส้นทางเดิม คำถามค้นงานไม่แก้ร่างส่งงานที่ค้างอยู่

## ขอบเขตข้อมูลและข้อจำกัด

- Agent ค้นเฉพาะงานตนเอง; Admin/Secretary ค้นตามสิทธิ์เดิม ตรวจ Active/role/binding และการย้ายเจ้าของอีกครั้งก่อนส่ง
- ส่งเฉพาะชื่องาน ประเภท เจ้าของ สถานะ วันกำหนด และความคืบหน้าที่เปิดให้บทบาทนั้นเห็น ไม่มี Description, Case Name, หมายเหตุภายใน เอกสารแนบ หรือค่าฟิลด์ส่วนตัวใน workflow
- รายการ checklist ที่ยังไม่ครบไม่ยืนยันว่าลูกค้ายังไม่ส่งเอกสารหรือไม่ผ่านการพิจารณา โมเดลต้องไม่เติมข้อเท็จจริงที่ไม่มี
- รองรับไม่เกิน 250 งานและ metadata 60,000 ตัวอักษรต่อคำถาม หลังกรองเจ้าของ/ประเภท/สถานะ หากเกินให้ผู้ใช้จำกัดคำถาม ไม่ค้นเงียบ ๆ เฉพาะ 60 งานแรก
- โมเดลคืน JSON `{taskIds: [...]}` เท่านั้น IDs นอกชุด คำตอบผิดรูปแบบ หรือไม่เลือกงาน จะไม่ทำให้ส่งทั้งรายการเป็น fallback
- Memory จำเฉพาะผลที่ส่งจริงและเก็บรหัสสำหรับถามต่อ ไม่ให้ผลว่างอ้างเคสเดียวที่โมเดลไม่ได้เลือก

## การปล่อยและย้อนกลับ

1. สำรอง Neon/ทดสอบ restore แล้วรัน migration `012_ai_task_search.sql` เพิ่ม nullable `hvr_ai_events.task_search_context`; คอลัมน์นี้เก็บบริบทที่อนุญาตและถูกล้างตามอายุ event เดิม
2. Deploy โดย `AI_TASK_SEARCH_ENABLED=false` (default) โค้ดเส้นทางเดิมไม่ต้องอ่าน/เขียนคอลัมน์ใหม่โดยตรงเมื่อยังปิด flag
3. สำรอง n8n ปัจจุบัน แล้วเปลี่ยนเฉพาะ JSON ของ OpenRouter ด้วยไฟล์ที่สร้างจาก `tools/build-n8n-ai.mjs` คง credential/webhook และการตอบ LINE ครั้งเดียว
4. เมื่อ Publish แล้วเปิด `AI_TASK_SEARCH_ENABLED=true` เฉพาะ Production และ redeploy ตรวจ alias, SHA, flags และ migrations ก่อนให้ผู้ใช้ลองคำถามจริง
5. ตรวจค้นงานหลังลำดับ 60, สิทธิ์, สถานะที่เปลี่ยนระหว่างตอบ, follow-up และร่าง/สรุป/เอกสารเดิม ไม่ถือว่าผลโมเดลจำลองแทน live LINE smoke test

หากค้นงานใหม่มีปัญหา ปิด `AI_TASK_SEARCH_ENABLED` แล้ว redeploy คงข้อมูลและ workflow รุ่นที่รองรับทุกโหมดไว้ ไม่ต้องปิด `AI_FORMS_ENABLED` หรือเปลี่ยน OA แจ้งเตือน `@688rmrty`

## สถานะ

อัปเดต 15 พฤศจิกายน 2569: เปิด `AI_TASK_SEARCH_ENABLED` ใน Production แล้ว ตรวจ n8n ผ่าน Chrome พบ Published และ Export workflow จริงสำเร็จ Prompt/contract ตรงกับ repo ยกเว้นโมเดล: live ใช้ `openai/gpt-6-luna` แต่ generator ใช้ `openai/gpt-6.1-sol` คงค่า live ตามที่พบ ไม่เปลี่ยนโมเดลหรือ credentials ระหว่างตรวจ เอกสารและคำถามงานใช้ workflow เดียวกันโดยมีจุดส่งคำตอบผ่านเว็บเพียงจุดเดียว

การยืนยันชุดทดสอบเอกสาร/Drive/favorites บน iPhone ไม่ใช่หลักฐานผ่าน semantic task search ทุกกรณี ยังต้องตรวจค้นงานด้วยโมเดลจริง สิทธิ์ข้ามเจ้าของ การถามต่อ และร่างงานเดิมตามรายการปล่อยด้านบน

ประวัติ 13 พฤศจิกายน: พัฒนา commit `3292818` แล้ว Local ผ่าน lint/typecheck/build, unit 32, integration 67 และ n8n contract 4 กรณี (รวม task search ใหม่ 6 กรณี) ทดสอบด้วยข้อมูลและโมเดลจำลอง เจ้าของยืนยัน **“Publish ค้นงานแล้ว”** หลังใช้ไฟล์ `output/n8n/task-search/openrouter-body-expression.txt` ขณะนั้น Chrome ยังเชื่อมไม่ได้; ผลตรวจ workflow จริงวันที่ 15 พฤศจิกายนข้างต้นแทนข้อจำกัดเดิมนี้

สำรอง Production run `f84ef155-6c8c-4350-bb1d-bb8582c8bd17` แบบ read-only snapshot/AES-GCM ผ่าน restore 27 ตารางพร้อม constraints ใน Docker ที่ไม่มี network/ports และปฏิเสธ archive เสียหาย รอบก่อนหน้าติด `pg_attver` จึงอัปเดตเครื่องมือ dump/restore จาก PostgreSQL 18.6 เป็น 18.7 แล้วสำรองใหม่จนผ่าน ไม่มีการแก้ dump เพื่อลบข้อผิดพลาด (อ้างอิง [release 18.7](https://www.postgresql.org/docs/release/18.7/))

Migration 012 ผ่านทั้ง Staging และ Production โดย runtime writes=true/jobs=false คงเดิม Staging `dpl_67gYK8bjjBz7YvkcKewXA3EgXfmN` READY และตรวจ alias/SHA/public endpoints/anonymous access/migration checksums ผ่าน

[CI ชุดเต็ม](https://github.com/Burinboo256/Happy_Victory_Task_Center/actions/runs/43386432253) ผ่านก่อน push main เปิด `AI_TASK_SEARCH_ENABLED=true` เฉพาะ Production โดยคง `AI_FORMS_ENABLED=true` แล้ว Deploy `dpl_E5v5mix6uGv1ZDSAzZyDFzYrB2MJ` จาก `3292818` READY ตรวจ production alias, public endpoints, anonymous access, forged signature และ migration 010–012 checksums ผ่าน เวลา 13:39 น. Asia/Bangkok วันที่ 13 พฤศจิกายน 2569 หลักฐาน `artifacts/vercel/task-search-production-release.json` ยังระบุ `lineLive=false` เพราะรอเจ้าของลองค้นงานด้วยโมเดลจริงใน OA
