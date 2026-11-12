# สถานะคลังเอกสารและ LINE AI

อัปเดต 13 พฤศจิกายน 2569 กำลังดำเนินการตาม [แผน Production](forms-production-plan.md) ยังไม่เปิดฟีเจอร์ใน Production

## พัฒนาแล้ว

- คลัง `/forms` แบบแถวกระชับ ค้น/กรอง/แบ่งหน้า รายการโปรดใน Neon แยกบัญชีและ environment
- Admin/เลขาสร้างร่าง เลขาแก้เฉพาะร่างตน Admin ตรวจเผยแพร่ เปลี่ยนฉบับและพักใช้ ตรวจสิทธิ์ที่ service/API พร้อม CSRF และ optimistic revision
- ลิงก์ Allianz/Drive เท่านั้น ไม่มีอัปโหลดหรือเก็บไฟล์ เส้นทางเปิดตรวจฉบับปัจจุบันและสิทธิ์ก่อน redirect
- LINE document context v2, aliases ภาษาไทย, favorites, ถามต่อจากลำดับเอกสาร, ตรวจสิทธิ์และ version ก่อนตอบ และ fallback ที่สร้างชื่อ/ลิงก์จากทะเบียน
- migrations `010_documents.sql` และ `011_ai_documents.sql`; เพิ่มใน Neon Staging แล้ว Production ยังอยู่ถึง 009
- [คู่มือผู้ใช้และผู้ดูแล](forms-library.md) และ workflow n8n ที่สร้างจาก generator เดิม

## หลักฐานตรวจในเครื่อง

- Typecheck, Biome lint และ production build ผ่าน
- Unit 32, PGlite integration 56, PostgreSQL 11 และ root regression 67 กรณีผ่าน
- API จริงบนฐานทดสอบผ่าน 20 กรณี รวม CSRF/สิทธิ์ร่าง/Inactive/redirect ปัจจุบัน และงานเดิม
- E2E ผ่าน 71 จาก 72 กรณีในการรันเต็ม อีกกรณีติดไฟล์ trace ชนกันระหว่างสองชุดทดสอบ แยก output directory แล้วตรวจกรณีเชื่อม LINE ซ้ำผ่านทั้ง desktop/mobile (2 กรณี) การจำลอง viewport ไม่เท่ากับอุปกรณ์จริง
- PostgreSQL ตรวจคำขอสร้าง/เผยแพร่พร้อมกัน การปฏิเสธ revision เก่า และ favorite ไม่ซ้ำ
- Import dry-run: 43 รายการเป็นร่างทั้งหมด รันซ้ำไม่เขียนทับข้อมูลที่แก้แล้ว

## Staging และรายการรอตรวจ

Vercel/Neon แยกจาก Production ตรวจ instance/Base และ migration ก่อนเขียนแล้ว ใช้ feature flags `FORMS_ENABLED` และ `AI_FORMS_ENABLED`; ค่าเริ่มต้น false

นำเข้า Staging แล้ว 43 รายการ เผยแพร่ 40 รายการ และคง 3 ลิงก์รอตรวจเป็นร่าง เพิ่ม Drive **แบบประกัน** เป็นร่างอีก 1 รายการ ยังไม่เก็บไฟล์ใด ๆ ตั้ง `FORMS_ENABLED=true` เฉพาะ Preview branch staging แล้ว; ยังไม่ deploy โค้ดรุ่นนี้และยังไม่เปิด AI เอกสาร

- แหล่ง Allianz 40 ลิงก์ตรวจได้จากงาน Local; 3 ลิงก์ยังรอตรวจ ได้แก่รับเอกสารผ่านอีเมล, W-8BEN และ W-8BEN-E เครื่องมือรายงาน cache miss จึงเก็บเป็นร่าง ไม่สรุปว่าไฟล์เสีย
- ได้ลิงก์ Drive ตัวอย่างชื่อ **แบบประกัน** แล้ว ต้องตรวจการเปิดด้วยบัญชี Agent/เลขาจริงก่อนเผยแพร่ เก็บ URL เฉพาะข้อมูล Staging/ไฟล์ปฏิบัติงานที่ Git ignore
- เจ้าของแจ้งว่ายังไม่มี OA ทดสอบแยก จึงยังไม่ผ่าน LINE end-to-end บน Staging ห้ามนับการทดสอบจำลองเป็นผลจริงหรือย้าย webhook OA Production มาทดสอบ
- ช่องเชื่อมต่อ Chrome ไม่พร้อมเมื่อเข้าตรวจ Drive/n8n จึงยังไม่มีผลตรวจ UI ของสองบริการนั้นรอบนี้
- ยังต้องตรวจ Login/สิทธิ์จริงทั้งสามบทบาท, Drive, iPhone/Android/iPad และทดสอบ LINE ก่อนผ่านขั้นเปิด Production

## ขั้นเปิด Production ที่ยังเหลือ

1. ผ่านการตรวจรับ Staging และจัดการข้อจำกัด OA ทดสอบให้ชัดเจนกับเจ้าของ
2. สำรอง Neon พร้อมตรวจ restore และ export workflow n8n ปัจจุบัน
3. เพิ่ม migration 010–011 ก่อน deploy โดยปิดทั้งสอง flags; โค้ด memory ใหม่ใช้คอลัมน์จาก 011 แม้ยังปิด AI เอกสาร
4. นำเข้าร่าง ตรวจ/เผยแพร่เฉพาะลิงก์พร้อมใช้ เปิดเว็บ ทดสอบบัญชีจริง แล้วอัปเดต n8n และเปิด AI เอกสาร
5. Smoke test OA จริง: HC1, Drive, ถามต่อ, favorites, ไม่มีสิทธิ์, สรุปงาน/ร่างงานเดิม และหนึ่งคำตอบต่อ event

## การนำเข้าและย้อนกลับ

จาก `web/` ใช้ `npm run forms:import` ตรวจข้อมูลโดยไม่เชื่อมฐานข้อมูล; การเขียนจริงใช้ `npm run forms:import -- --apply --admin-email=<Active Admin email>` ภายใต้ environment ที่ตั้งถูกต้อง คำสั่งนำเข้าไม่เผยแพร่และไม่แทนค่ารายการเดิม

ปิด `AI_FORMS_ENABLED` และ redeploy เพื่อหยุดค้นเอกสารผ่าน LINE; ปิด `FORMS_ENABLED` เพิ่มเพื่อปิดเว็บ คงตาราง/ฉบับ/ดาวไว้ ไม่ drop ตารางหรือ restore ทับงานใหม่ OA แจ้งเตือน `@688rmrty` และ Airtable Tasks ไม่เปลี่ยนจากฟีเจอร์นี้
