# สถานะคลังเอกสารและ LINE AI

อัปเดต 13 พฤศจิกายน 2569 กำลังดำเนินการตาม [แผน Production](forms-production-plan.md) เปิดส่วนเว็บ Production แล้ว 40 รายการ และเปิดค้นเอกสารผ่าน LINE เพื่อทดสอบจริงหลังเจ้าของยืนยันอัปเดต HTTP Request และ Publish n8n แล้ว ยังรอผล LINE end-to-end จึงไม่ถือว่าจบแผนทั้งหมด

## พัฒนาแล้ว

- คลัง `/forms` แบบแถวกระชับ ค้น/กรอง/แบ่งหน้า รายการโปรดใน Neon แยกบัญชีและ environment
- Admin/เลขาสร้างร่าง เลขาแก้เฉพาะร่างตน Admin ตรวจเผยแพร่ เปลี่ยนฉบับและพักใช้ ตรวจสิทธิ์ที่ service/API พร้อม CSRF และ optimistic revision
- ลิงก์ Allianz/Drive เท่านั้น ไม่มีอัปโหลดหรือเก็บไฟล์ เส้นทางเปิดตรวจฉบับปัจจุบันและสิทธิ์ก่อน redirect
- LINE document context v2, aliases ภาษาไทย, favorites, ถามต่อจากลำดับเอกสาร, ตรวจสิทธิ์และ version ก่อนตอบ และ fallback ที่สร้างชื่อ/ลิงก์จากทะเบียน
- migrations `010_documents.sql` และ `011_ai_documents.sql`; เพิ่มใน Neon Staging และ Production แล้ว ตรวจ checksums ตรงไฟล์และ environment/Base แยกกัน
- [คู่มือผู้ใช้และผู้ดูแล](forms-library.md) และ workflow n8n ที่สร้างจาก generator เดิม

## หลักฐานตรวจในเครื่อง

- Typecheck, Biome lint และ production build ผ่าน
- Unit 32, PGlite integration 56, PostgreSQL 11 และ root regression ผ่าน รวม test document contract ของ n8n
- API จริงบนฐานทดสอบผ่าน 20 กรณี รวม CSRF/สิทธิ์ร่าง/Inactive/redirect ปัจจุบัน และงานเดิม
- E2E ผ่าน 71 จาก 72 กรณีในการรันเต็ม อีกกรณีติดไฟล์ trace ชนกันระหว่างสองชุดทดสอบ แยก output directory แล้วตรวจกรณีเชื่อม LINE ซ้ำผ่านทั้ง desktop/mobile (2 กรณี) การจำลอง viewport ไม่เท่ากับอุปกรณ์จริง
- PostgreSQL ตรวจคำขอสร้าง/เผยแพร่พร้อมกัน การปฏิเสธ revision เก่า และ favorite ไม่ซ้ำ
- Import dry-run: 43 รายการเป็นร่างทั้งหมด รันซ้ำไม่เขียนทับข้อมูลที่แก้แล้ว
- CI commit `fd420a8` ผ่านครบทั้ง [staging](https://github.com/Burinboo256/Happy_Victory_Task_Center/actions/runs/43318856746) และ [main](https://github.com/Burinboo256/Happy_Victory_Task_Center/actions/runs/43320357994): lint, typecheck, unit/integration/PostgreSQL, audit, build, E2E, API และโหลดจำลอง 5 คน/250 งาน

## Staging และรายการรอตรวจ

Vercel/Neon แยกจาก Production ตรวจ instance/Base และ migration ก่อนเขียนแล้ว ใช้ feature flags `FORMS_ENABLED` และ `AI_FORMS_ENABLED`; ค่าเริ่มต้น false

นำเข้า Staging 43 รายการ เผยแพร่ 40 รายการ และคง 3 ลิงก์รอตรวจเป็นร่าง เพิ่ม Drive **แบบประกัน** เป็นร่างอีก 1 รายการ ตั้ง `FORMS_ENABLED=true` เฉพาะ Preview branch staging แล้ว Deploy `fd420a8` เป็น `dpl_2UCDtMwfGWibhNf1LB7vqmacFFDD` พร้อมผูก alias เดิมให้ตรง ตรวจ public endpoints และ checksum ผ่าน

เจ้าของตอบ **“ผ่านหมด”** ต่อรายการทดสอบ Admin/เลขา/Agent: ค้น HC1 เปิดเอกสาร ติดดาว/โหลดใหม่ เพิ่มร่าง และเปิด Drive ตัวอย่าง ผลนี้เป็นคำยืนยันของเจ้าของ ไม่ใช่การตรวจอุปกรณ์จริงโดยเครื่องมือ

- แหล่ง Allianz 40 ลิงก์ตรวจได้จากงาน Local; 3 ลิงก์ยังรอตรวจ ได้แก่รับเอกสารผ่านอีเมล, W-8BEN และ W-8BEN-E เครื่องมือรายงาน cache miss จึงเก็บเป็นร่าง ไม่สรุปว่าไฟล์เสีย
- ได้ลิงก์ Drive ตัวอย่างชื่อ **แบบประกัน** และคำยืนยันผลทดสอบจากเจ้าของแล้ว เก็บ URL เฉพาะ Staging/ไฟล์ปฏิบัติงานที่ Git ignore ไม่ย้ายรายการทดสอบนี้หรือดาวทดสอบเข้า Production อัตโนมัติ
- เจ้าของแจ้งว่ายังไม่มี OA ทดสอบแยก จึงยังไม่ผ่าน LINE end-to-end บน Staging ห้ามนับการทดสอบจำลองเป็นผลจริงหรือย้าย webhook OA Production มาทดสอบ
- ช่องเชื่อมต่อ Chrome ไม่พร้อมเมื่อเข้าตรวจ Drive/n8n จึงยังไม่มีผลตรวจ UI ของสองบริการนั้นรอบนี้
- เจ้าของยืนยันอัปเดต HTTP Request node ที่เรียก OpenRouter และกด Publish แล้ว แต่เครื่องมือยังตรวจ workflow/settings/ไฟล์สำรองใน n8n ไม่ได้; ไม่ถือว่าผลทดสอบเว็บแทนผล LINE

## Production ส่วนเว็บ

- สำรอง Neon แบบ snapshot อ่านอย่างเดียวเข้ารหัสและ restore ใน Docker `--network=none` ผ่าน 23 ตาราง/constraints พร้อมปฏิเสธ archive ที่เสียหาย Run `b490cc43-510b-4709-9e0a-3d13e6b65d8b` เก็บไฟล์และกุญแจใน ignored private artifacts แยกกัน
- นำเข้า 43 ร่าง แล้วเผยแพร่ 40 รายการที่ตรวจแล้ว อีก 3 รายการยังเป็นร่าง ไม่มี Airtable record writes หรือไฟล์เอกสารที่เก็บในระบบ
- Deploy code `fd420a8` จาก main โดยเริ่มปิด flags แล้วเปิดเฉพาะ `FORMS_ENABLED=true` และ redeploy เป็น `dpl_A8X5Geb527XU31LmfQUpCqMAfwuK` READY; `https://happy-victory-task-center.vercel.app/forms`
- หลังเจ้าของรายงาน AI ตอบว่าค้นได้เฉพาะงาน ตรวจ Vercel พบ `AI_FORMS_ENABLED=false` จึงเปิดเป็น `true` หลังเจ้าของยืนยัน Publish n8n แล้ว และ redeploy เป็น `dpl_HpMxhF8Lj1XguU4NRajhKoNrRMj2` READY ที่ alias Production เดิม (commit `fd420a8`) เวลา 12:54 น. Asia/Bangkok เพื่อทดสอบ OA จริง ไม่เปลี่ยน credential หรือ webhook ของสอง OA
- ตรวจหลังเปิด flag: health/forms/login, anonymous access, forged signature, migration checksums และ environment/Base ผ่าน; เอกสาร 40 published/3 drafts, task writes=true/jobs=false คงเดิม หลักฐานอัตโนมัติ `artifacts/vercel/forms-production-release.json` ระบุ `lineLive=false` เพราะไม่ได้ส่งข้อความ LINE ในสคริปต์
- เจ้าของยืนยัน **“ได้รับเอกสารแล้ว”** หลังส่งคำถาม HC1 ใหม่ใน OA `@672vhuss` ถือว่าค้นและรับเอกสารผ่าน LINE Production ผ่านตามคำยืนยันผู้ใช้ ยังไม่ยืนยันการเปิดลิงก์, favorites, การถามต่อ, สิทธิ์ข้ามบัญชี หรือสรุป/ร่างงานเดิมจากผลนี้
- Public checks ผ่าน: health/login/forms 200, anonymous forms/bootstrap/AI account 401, forged AI signature 401, Local preview 404; runtime task writes=true/jobs=false คงเดิม เจ้าของยืนยัน **“production ผ่าน”** หลังลองรายการ ค้น HC1 เปิดเอกสาร และติดดาว/โหลดใหม่ด้วยบัญชีจริง

## ขั้นเปิด Production ที่ยังเหลือ

ปรับปรุงที่ตรวจ Local แล้ว: คำถาม “มีฟอร์มเกี่ยวกับ มอบอำนาจ ตัวแทนไหม” จะใช้ AI เลือกจาก metadata ที่อนุญาตเมื่อค้นตรงคำไม่พบ รองรับ contract v2/HTTP Request เดิม ไม่มี migration ใหม่; ผลจำกัด 5 รายการ ไม่แต่งลิงก์และไม่ส่งทั้งคลังเมื่อ AI ตอบไม่ได้ รหัสตรงและ favorites ยังใช้การค้นเดิม Lint/typecheck/build, unit 32 และ integration 61 ผ่าน; หลังปรับ alias ให้รักษารายละเอียดประเภทกรมธรรม์ ตรวจชุด AI documents ซ้ำผ่าน 10 กรณี ผลเหล่านี้ใช้โมเดลจำลอง ยังรอ deploy และคำถามจริงก่อนนับว่าโมเดลเลือกเอกสารสำเร็จ

1. เพิ่ม Drive จริงผ่านร่าง/ตรวจ/เผยแพร่เมื่อต้องการใช้จริง ไม่ย้ายตัวอย่างทดสอบอัตโนมัติ
2. เมื่อเชื่อม Chrome/n8n ได้ ให้ตรวจ workflow ที่เจ้าของ Publish รวม settings/credential และยืนยันว่ามี export สำรองก่อนแก้
3. ไม่มี OA ทดสอบแยก จึงตรวจรับผ่าน OA Production เดิมกับเจ้าของหลังเปิด flag ไม่ย้าย webhook ไป Staging และไม่รายงานว่า LINE Staging ผ่าน
4. เจ้าของอัปเดต/Publish n8n แล้วและเปิด `AI_FORMS_ENABLED=true` แล้ว; ค้น HC1 และรับเอกสารสำเร็จตามคำยืนยันเจ้าของ
5. Smoke test OA จริงที่ยังเหลือ: เปิดลิงก์ HC1, Drive ที่เผยแพร่, ถามต่อ, favorites, ไม่มีสิทธิ์, สรุปงาน/ร่างงานเดิม และหนึ่งคำตอบต่อ event

## การนำเข้าและย้อนกลับ

จาก `web/` ใช้ `npm run forms:import` ตรวจข้อมูลโดยไม่เชื่อมฐานข้อมูล; การเขียนจริงใช้ `npm run forms:import -- --apply --admin-email=<Active Admin email>` ภายใต้ environment ที่ตั้งถูกต้อง คำสั่งนำเข้าไม่เผยแพร่และไม่แทนค่ารายการเดิม

ปิด `AI_FORMS_ENABLED` และ redeploy เพื่อหยุดค้นเอกสารผ่าน LINE; ปิด `FORMS_ENABLED` เพิ่มเพื่อปิดเว็บ คงตาราง/ฉบับ/ดาวไว้ ไม่ drop ตารางหรือ restore ทับงานใหม่ OA แจ้งเตือน `@688rmrty` และ Airtable Tasks ไม่เปลี่ยนจากฟีเจอร์นี้
